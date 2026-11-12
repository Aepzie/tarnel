/**
 * Privacy report (tarnel://privacy): local-only daily aggregates. Pure — no Electron imports, so the
 * aggregation, rollover and estimates are unit-tested (privacy-report.test.ts) and the types are
 * shared with the renderer.
 *
 * What is stored: per calendar day (local time) one bucket with counter totals, the same counters
 * per Space, and blocked-request counts per registrable domain (eTLD+1 of the *tracker*, never the
 * page you were on and never a path). Burner Spaces count towards the totals only: no per-Space row
 * and no domains. Buckets older than KEEP_DAYS are dropped on every flush.
 *
 * Adding a counter is one line in PRIVACY_COUNTERS (plus the call that increments it).
 */

export const PRIVACY_COUNTERS = {
  trackersBlocked: 'Trackers and ads blocked',
  paramsStripped: 'Tracking parameters removed',
  referrersTrimmed: 'Referrers trimmed',
  dangerousWarned: 'Dangerous sites warned',
  fingerprintMitigated: 'Fingerprinting attempts mitigated',
  cookieBannersHandled: 'Cookie banners rejected',
  bytesSaved: 'Data saved (bytes, estimated)',
} as const;

export type PrivacyCounter = keyof typeof PRIVACY_COUNTERS;
/** Sparse: a missing counter is 0. Keys are counter names (unknown keys from newer versions survive). */
export type PrivacyCounts = Partial<Record<string, number>>;

export interface PrivacyDay {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  total: PrivacyCounts;
  spaces: Record<string, PrivacyCounts>;
  /** Blocked requests per tracker registrable domain. */
  domains: Record<string, number>;
}

export interface PrivacyLog {
  version: 1;
  /** Ascending by day, at most KEEP_DAYS entries. */
  days: PrivacyDay[];
}

export const PRIVACY_REPORT_IPC = {
  get: 'pages:privacy-report',
  reset: 'pages:privacy-report-reset',
} as const;

export const KEEP_DAYS = 90;
/** Per-day cap on stored tracker domains (the long tail is folded away, keeping the biggest). */
export const MAX_DOMAINS_PER_DAY = 150;
export const EMPTY_LOG: PrivacyLog = { version: 1, days: [] };

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

/**
 * Typical transfer size of a blocked request by resource type (bytes). Rough medians of
 * third-party ad/analytics payloads (HTTP Archive orders of magnitude); good enough for an
 * "about this much" figure, deliberately conservative.
 */
const TYPE_BYTES: Record<string, number> = {
  script: 25_000,
  sub_frame: 40_000,
  subFrame: 40_000,
  image: 8_000,
  imageset: 8_000,
  stylesheet: 8_000,
  font: 20_000,
  media: 120_000,
  xmlhttprequest: 1_500,
  xhr: 1_500,
  fetch: 1_500,
  ping: 300,
  beacon: 300,
  csp_report: 300,
  websocket: 1_000,
};
const DEFAULT_BYTES = 2_000;

export function estimateBlockedBytes(resourceType: string | undefined): number {
  return (resourceType && TYPE_BYTES[resourceType]) || DEFAULT_BYTES;
}

/** Reference connection: 10 Mbit/s = 1250 bytes per ms. */
export const REFERENCE_BYTES_PER_MS = 1250;
/** Per blocked request: connection setup / scheduling / main-thread work avoided (ms). */
export const PER_REQUEST_MS = 5;

/**
 * Time saved (ms) = bytesSaved / 1250 (download time at 10 Mbit/s) + 5 ms × blocked requests.
 * Blocked requests mostly run in parallel with the page, so this is "work avoided", not wall-clock
 * page-load time; the report says "about".
 */
export function estimateTimeSavedMs(counts: PrivacyCounts): number {
  return Math.round((counts.bytesSaved ?? 0) / REFERENCE_BYTES_PER_MS + (counts.trackersBlocked ?? 0) * PER_REQUEST_MS);
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0');

export function dayKey(time: Date | number): string {
  const date = typeof time === 'number' ? new Date(time) : time;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day `offset` days from `day` (local calendar arithmetic; DST safe). */
export function shiftDay(day: string, offset: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + offset, 12));
}

export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ---------------------------------------------------------------------------
// Pending (in-memory) increments
// ---------------------------------------------------------------------------

export function emptyDay(day: string): PrivacyDay {
  return { day, total: {}, spaces: {}, domains: {} };
}

function add(counts: PrivacyCounts, counter: string, amount: number): void {
  counts[counter] = (counts[counter] ?? 0) + amount;
}

export interface PrivacyEvent {
  counter: PrivacyCounter | (string & {});
  amount: number;
  /** null: not attributable to a Space (or a burner Space: totals only). */
  spaceId: string | null;
  /** Tracker registrable domain (only for blocked requests, never for burner Spaces). */
  domain?: string;
}

/** Adds one event to the pending bucket of `day` (mutates `pending`; cheap, O(1)). */
export function bump(pending: Map<string, PrivacyDay>, day: string, event: PrivacyEvent): void {
  if (!(event.amount > 0) || !Number.isFinite(event.amount)) return;
  let bucket = pending.get(day);
  if (!bucket) {
    bucket = emptyDay(day);
    pending.set(day, bucket);
  }
  add(bucket.total, event.counter, event.amount);
  if (event.spaceId) add((bucket.spaces[event.spaceId] ??= {}), event.counter, event.amount);
  if (event.domain) bucket.domains[event.domain] = (bucket.domains[event.domain] ?? 0) + 1;
}

function mergeCounts(into: PrivacyCounts, from: PrivacyCounts): PrivacyCounts {
  const out: PrivacyCounts = { ...into };
  for (const [key, value] of Object.entries(from)) if (typeof value === 'number' && value > 0) add(out, key, value);
  return out;
}

function capDomains(domains: Record<string, number>): Record<string, number> {
  const entries = Object.entries(domains);
  if (entries.length <= MAX_DOMAINS_PER_DAY) return domains;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_DOMAINS_PER_DAY));
}

function mergeDay(into: PrivacyDay, from: PrivacyDay): PrivacyDay {
  const spaces: Record<string, PrivacyCounts> = { ...into.spaces };
  for (const [id, counts] of Object.entries(from.spaces)) spaces[id] = mergeCounts(spaces[id] ?? {}, counts);
  const domains: Record<string, number> = { ...into.domains };
  for (const [domain, count] of Object.entries(from.domains)) domains[domain] = (domains[domain] ?? 0) + count;
  return { day: into.day, total: mergeCounts(into.total, from.total), spaces, domains: capDomains(domains) };
}

/**
 * Folds pending buckets into the persisted log and drops days older than `keepDays` before
 * `today` (rollover). Pure: returns a new log.
 */
export function mergeLog(log: PrivacyLog, pending: Iterable<PrivacyDay>, today: string, keepDays = KEEP_DAYS): PrivacyLog {
  const byDay = new Map(log.days.map((day) => [day.day, day]));
  for (const bucket of pending) {
    const existing = byDay.get(bucket.day);
    byDay.set(bucket.day, mergeDay(existing ?? emptyDay(bucket.day), bucket));
  }
  const oldest = shiftDay(today, -(keepDays - 1));
  const days = [...byDay.values()].filter((day) => day.day >= oldest && day.day <= today).sort((a, b) => (a.day < b.day ? -1 : 1));
  return { version: 1, days };
}

/** Removes a Space's rows (the Space was deleted); totals keep its history. */
export function forgetSpace(log: PrivacyLog, spaceId: string): PrivacyLog {
  return {
    version: 1,
    days: log.days.map((day) => {
      if (!(spaceId in day.spaces)) return day;
      const spaces = { ...day.spaces };
      delete spaces[spaceId];
      return { ...day, spaces };
    }),
  };
}

/** Repairs whatever was read from disk (hand-edited, older or corrupt file). */
export function sanitizeLog(raw: unknown): PrivacyLog {
  const days = (raw as { days?: unknown } | null)?.days;
  if (!Array.isArray(days)) return { version: 1, days: [] };
  const clean = (value: unknown): PrivacyCounts => {
    const out: PrivacyCounts = {};
    if (typeof value !== 'object' || value === null) return out;
    for (const [key, count] of Object.entries(value)) if (typeof count === 'number' && Number.isFinite(count) && count > 0) out[key] = count;
    return out;
  };
  const valid: PrivacyDay[] = [];
  for (const day of days) {
    if (typeof day !== 'object' || day === null || !isDayKey((day as PrivacyDay).day)) continue;
    const entry = day as PrivacyDay;
    const spaces: Record<string, PrivacyCounts> = {};
    if (typeof entry.spaces === 'object' && entry.spaces !== null) for (const [id, counts] of Object.entries(entry.spaces)) spaces[id] = clean(counts);
    valid.push({ day: entry.day, total: clean(entry.total), spaces, domains: clean(entry.domains) as Record<string, number> });
  }
  return { version: 1, days: valid.sort((a, b) => (a.day < b.day ? -1 : 1)) };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface PrivacyReportDomain {
  domain: string;
  company: string | null;
  count: number;
}

export interface PrivacyReportSpace {
  spaceId: string;
  counts: PrivacyCounts;
  /** Filled in by the main process (null/undefined in the pure report). */
  name?: string;
  color?: string | null;
}

export interface PrivacyReport {
  today: string;
  /** First day with data (null: nothing recorded yet). */
  since: string | null;
  /** The last 7 days including today. */
  thisWeek: PrivacyCounts;
  /** The 7 days before that. */
  lastWeek: PrivacyCounts;
  /** Everything kept (up to 90 days). */
  allTime: PrivacyCounts;
  /** 14 days, oldest first: trackers blocked per day (the chart). */
  daily: { day: string; trackersBlocked: number }[];
  /** This week's top tracker domains. */
  topDomains: PrivacyReportDomain[];
  /** This week's top companies (domains without a known owner are left out). */
  topCompanies: { company: string; count: number; domains: number }[];
  /** This week per Space (Spaces with no activity are left out). */
  spaces: PrivacyReportSpace[];
  timeSavedMs: { thisWeek: number; allTime: number };
}

function sumDays(days: readonly PrivacyDay[]): PrivacyCounts {
  return days.reduce<PrivacyCounts>((acc, day) => mergeCounts(acc, day.total), {});
}

export function buildReport(log: PrivacyLog, today: string, companyOf: (domain: string) => string | null, topN = 10): PrivacyReport {
  const weekStart = shiftDay(today, -6);
  const lastWeekStart = shiftDay(today, -13);
  const inRange = (from: string, to: string) => log.days.filter((day) => day.day >= from && day.day <= to);
  const week = inRange(weekStart, today);
  const thisWeek = sumDays(week);
  const allTime = sumDays(log.days);

  const byDay = new Map(log.days.map((day) => [day.day, day]));
  const daily = Array.from({ length: 14 }, (_, index) => {
    const day = shiftDay(today, index - 13);
    return { day, trackersBlocked: byDay.get(day)?.total.trackersBlocked ?? 0 };
  });

  const domainCounts = new Map<string, number>();
  for (const day of week) for (const [domain, count] of Object.entries(day.domains)) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + count);
  const sortedDomains = [...domainCounts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const topDomains = sortedDomains.slice(0, topN).map(([domain, count]) => ({ domain, company: companyOf(domain), count }));

  const companies = new Map<string, { count: number; domains: number }>();
  for (const [domain, count] of sortedDomains) {
    const company = companyOf(domain);
    if (!company) continue;
    const entry = companies.get(company) ?? { count: 0, domains: 0 };
    companies.set(company, { count: entry.count + count, domains: entry.domains + 1 });
  }
  const topCompanies = [...companies]
    .map(([company, entry]) => ({ company, ...entry }))
    .sort((a, b) => b.count - a.count || (a.company < b.company ? -1 : 1))
    .slice(0, topN);

  const spaceTotals = new Map<string, PrivacyCounts>();
  for (const day of week) for (const [id, counts] of Object.entries(day.spaces)) spaceTotals.set(id, mergeCounts(spaceTotals.get(id) ?? {}, counts));
  const spaces = [...spaceTotals]
    .map(([spaceId, counts]) => ({ spaceId, counts }))
    .sort((a, b) => (b.counts.trackersBlocked ?? 0) - (a.counts.trackersBlocked ?? 0));

  return {
    today,
    since: log.days[0]?.day ?? null,
    thisWeek,
    lastWeek: sumDays(inRange(lastWeekStart, shiftDay(today, -7))),
    allTime,
    daily,
    topDomains,
    topCompanies,
    spaces,
    timeSavedMs: { thisWeek: estimateTimeSavedMs(thisWeek), allTime: estimateTimeSavedMs(allTime) },
  };
}
