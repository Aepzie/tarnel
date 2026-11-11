import { Notification, type IpcMainInvokeEvent } from 'electron';
import {
  buildReport,
  dayKey,
  EMPTY_LOG,
  estimateTimeSavedMs,
  mergeLog,
  PRIVACY_REPORT_IPC,
  sanitizeLog,
  shiftDay,
  type PrivacyCounter,
  type PrivacyLog,
  type PrivacyReport,
} from '../../shared/privacy-report';
import { trackerCompany } from '../../shared/tracker-companies';
import { getSettings } from '../settings';
import { getSpace } from '../spaces';
import { createStore, onBeforeFlushAll, type JsonStore } from '../store';
import { drainPrivacyPending, setPrivacyPendingListener, setPrivacySpaceResolver, type SpaceOfWebContents } from './collector';

export { countBlockedRequest, countPrivacyEvent } from './collector';

/**
 * Privacy report owner: persists the collector's in-memory counts once a minute (only while
 * something was counted — no idle timer), serves vela://privacy, and shows the optional weekly
 * summary notice. All data stays in userData/privacy-report.json; nothing leaves the device.
 */

interface PrivacyStore extends PrivacyLog {
  /** Day the last weekly summary was shown (or the feature was first seen enabled). */
  lastNotice?: string;
}

/** A cumulative counter owned by another module, polled at every flush; only the growth is recorded. */
interface PolledSource {
  counter: PrivacyCounter | (string & {});
  read: () => number;
  last: number | null;
}

const FLUSH_INTERVAL_MS = 60_000;

let store: JsonStore<PrivacyStore> | null = null;
let timer: NodeJS.Timeout | null = null;
let openReport: () => void = () => undefined;
const sources: PolledSource[] = [];

function getStore(): JsonStore<PrivacyStore> {
  if (!store) {
    store = createStore<PrivacyStore>('privacy-report', { ...EMPTY_LOG });
    const raw = store.get();
    store.set({ ...sanitizeLog(raw), ...(typeof raw.lastNotice === 'string' ? { lastNotice: raw.lastNotice } : {}) });
  }
  return store;
}

/**
 * Register a counter another module keeps as a running total, e.g.
 * `registerPrivacySource('cookieBannersHandled', () => getCookieBannerStats().handled)`.
 * The first read is the baseline; afterwards each flush adds the difference (totals only).
 */
export function registerPrivacySource(counter: PrivacyCounter | (string & {}), read: () => number): void {
  sources.push({ counter, read, last: null });
}

function pollSources(): { counter: string; amount: number }[] {
  const deltas: { counter: string; amount: number }[] = [];
  for (const source of sources) {
    let value: number;
    try {
      value = source.read();
    } catch {
      continue;
    }
    if (!Number.isFinite(value)) continue;
    if (source.last !== null && value > source.last) deltas.push({ counter: source.counter, amount: value - source.last });
    source.last = value;
  }
  return deltas;
}

export function flushPrivacyReport(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const today = dayKey(Date.now());
  const pending = drainPrivacyPending();
  const deltas = pollSources();
  if (pending.length === 0 && deltas.length === 0) return;
  const polled = deltas.length > 0 ? [{ day: today, total: Object.fromEntries(deltas.map((d) => [d.counter, d.amount])), spaces: {}, domains: {} }] : [];
  const s = getStore();
  s.update((current) => ({ ...current, ...mergeLog(current, [...pending, ...polled], today) }));
  maybeWeeklyNotice(today);
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(flushPrivacyReport, FLUSH_INTERVAL_MS);
  timer.unref();
}

export function getPrivacyReport(): PrivacyReport {
  flushPrivacyReport();
  const report = buildReport(getStore().get(), dayKey(Date.now()), trackerCompany);
  return {
    ...report,
    spaces: report.spaces.map((row) => {
      const space = getSpace(row.spaceId);
      return { ...row, name: space?.name ?? 'Removed Space', color: space?.color ?? null };
    }),
  };
}

export function resetPrivacyReport(): void {
  drainPrivacyPending();
  const lastNotice = getStore().get().lastNotice;
  getStore().set({ ...EMPTY_LOG, ...(lastNotice ? { lastNotice } : {}) });
}

const formatCount = (n: number): string => Math.round(n).toLocaleString('en-US');

function maybeWeeklyNotice(today: string): void {
  if (!getSettings().privacyWeeklySummary) return;
  const s = getStore();
  const last = s.get().lastNotice;
  if (!last || last > today) {
    s.update((current) => ({ ...current, lastNotice: today })); // first week after enabling: start counting
    return;
  }
  if (today < shiftDay(last, 7)) return;
  const report = buildReport(s.get(), today, trackerCompany);
  s.update((current) => ({ ...current, lastNotice: today }));
  const blocked = report.thisWeek.trackersBlocked ?? 0;
  if (blocked <= 0 || !Notification.isSupported()) return;
  const mb = (report.thisWeek.bytesSaved ?? 0) / 1_000_000;
  const minutes = estimateTimeSavedMs(report.thisWeek) / 60_000;
  const notice = new Notification({
    title: 'Your week in privacy',
    body: `Vela blocked ${formatCount(blocked)} trackers this week and saved about ${mb.toFixed(mb < 10 ? 1 : 0)} MB${minutes >= 1 ? ` and ${Math.round(minutes)} min` : ''}.`,
    silent: true,
  });
  notice.on('click', () => openReport());
  notice.show();
}

export interface PrivacyReportDeps {
  /** webContents id → its Space (tabs.ts + spaces.ts), injected to keep this module cycle-free. */
  spaceOfWebContents: (webContentsId: number) => SpaceOfWebContents | null;
  /** Opens vela://privacy in a new tab (weekly notice click). */
  openReport: () => void;
}

export function initPrivacyReport(deps: PrivacyReportDeps): void {
  setPrivacySpaceResolver(deps.spaceOfWebContents);
  setPrivacyPendingListener(scheduleFlush);
  openReport = deps.openReport;
  onBeforeFlushAll(flushPrivacyReport);
}

type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

export function registerPrivacyReportIpc(handlePages: PagesHandler): void {
  handlePages(PRIVACY_REPORT_IPC.get, () => getPrivacyReport());
  handlePages(PRIVACY_REPORT_IPC.reset, () => resetPrivacyReport());
}
