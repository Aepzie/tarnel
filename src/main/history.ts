import type { HistoryEntry as HistoryListEntry, Suggestion, TopSite } from '../shared/types';
import { clearFavicons, faviconFor } from './favicons';
import { createStore, type JsonStore } from './store';

interface HistoryEntry {
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
}

/** Derived, lowercase search fields (never persisted). */
interface SearchFields {
  /** URL without scheme and leading "www.". */
  bare: string;
  host: string;
  title: string;
}

const MAX_ENTRIES = 5000;
/** Evict down to this size so eviction (a sort) does not run on every visit once full. */
const EVICT_TO = 4900;
const DAY = 86_400_000;
const HOST_PREFIX_BOOST = 1_000_000;

let store: JsonStore<HistoryEntry[]> | null = null;
const byUrl = new Map<string, HistoryEntry>();
const fields = new WeakMap<HistoryEntry, SearchFields>();

function computeFields(entry: HistoryEntry): SearchFields {
  const bare = entry.url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase();
  const slash = bare.search(/[/?#]/);
  return { bare, host: slash === -1 ? bare : bare.slice(0, slash), title: entry.title.toLowerCase() };
}

function fieldsOf(entry: HistoryEntry): SearchFields {
  let f = fields.get(entry);
  if (!f) {
    f = computeFields(entry);
    fields.set(entry, f);
  }
  return f;
}

function getStore(): JsonStore<HistoryEntry[]> {
  if (store) return store;
  store = createStore<HistoryEntry[]>('history', []);
  const raw = store.get();
  const valid = Array.isArray(raw)
    ? raw.filter(
        (e): e is HistoryEntry =>
          !!e && typeof e.url === 'string' && typeof e.visits === 'number' && typeof e.lastVisit === 'number',
      )
    : [];
  for (const e of valid) {
    if (typeof e.title !== 'string') e.title = '';
    byUrl.set(e.url, e);
  }
  if (valid.length !== (Array.isArray(raw) ? raw.length : -1)) store.set([...byUrl.values()]);
  return store;
}

function recencyWeight(ageMs: number): number {
  if (ageMs < 4 * DAY) return 100;
  if (ageMs < 14 * DAY) return 70;
  if (ageMs < 31 * DAY) return 50;
  if (ageMs < 90 * DAY) return 30;
  return 10;
}

function frecency(entry: HistoryEntry, now: number): number {
  return entry.visits * recencyWeight(now - entry.lastVisit);
}

function evictIfNeeded(): void {
  if (byUrl.size <= MAX_ENTRIES) return;
  const now = Date.now();
  const sorted = [...byUrl.values()].sort((a, b) => frecency(a, now) - frecency(b, now) || a.lastVisit - b.lastVisit);
  for (const e of sorted.slice(0, byUrl.size - EVICT_TO)) byUrl.delete(e.url);
}

function stripHash(url: string): string {
  const i = url.indexOf('#');
  return i === -1 ? url : url.slice(0, i);
}

export function recordVisit(url: string, title: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  const s = getStore();
  const key = stripHash(url);
  const cleanTitle = (typeof title === 'string' ? title : '').trim().slice(0, 300);
  const existing = byUrl.get(key);
  if (existing) {
    existing.visits += 1;
    existing.lastVisit = Date.now();
    if (cleanTitle && cleanTitle !== existing.title) {
      existing.title = cleanTitle;
      fields.delete(existing);
    }
  } else {
    byUrl.set(key, { url: key, title: cleanTitle, visits: 1, lastVisit: Date.now() });
    evictIfNeeded();
  }
  s.set([...byUrl.values()]);
}

/** Updates the title of an already-recorded URL without counting a visit (e.g. page-title-updated). */
export function updateTitle(url: string, title: string): void {
  getStore();
  const entry = byUrl.get(stripHash(url));
  const clean = (typeof title === 'string' ? title : '').trim().slice(0, 300);
  if (!entry || !clean || entry.title === clean) return;
  entry.title = clean;
  fields.delete(entry);
  getStore().set([...byUrl.values()]);
}

export function suggest(input: string, limit = 8): Suggestion[] {
  getStore();
  const query = (typeof input === 'string' ? input : '').trim().toLowerCase();
  if (!query || limit <= 0) return [];
  const prefix = query.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const tokens = prefix.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const now = Date.now();

  const scored: { entry: HistoryEntry; score: number }[] = [];
  outer: for (const entry of byUrl.values()) {
    const f = fieldsOf(entry);
    for (const t of tokens) {
      if (!f.bare.includes(t) && !f.title.includes(t)) continue outer;
    }
    let score = frecency(entry, now);
    if (f.host.startsWith(prefix) || f.bare.startsWith(prefix)) {
      score += HOST_PREFIX_BOOST;
      // Prefer the site root over deep pages when the user is typing a host.
      score += 1000 / (f.bare.length + 1);
    }
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ entry }) => ({ kind: 'history', title: entry.title || entry.url, url: entry.url }));
}

const SEARCH_RESULT_PAGE =
  /^(?:[\w-]+\.)*(?:google\.[a-z.]+\/(?:search|webhp)|bing\.com\/search|duckduckgo\.com\/(?:\?|.*[?&]q=)|search\.brave\.com\/search|(?:www\.)?startpage\.com\/(?:do\/|sp\/)?search|ecosia\.org\/search|search\.yahoo\.com\/search|yandex\.[a-z]+\/search|kagi\.com\/search)/;

const TOP_SITES_TTL_MS = 5000;
let topSitesCache: { at: number; limit: number; sites: TopSite[] } | null = null;

export function topSites(limit = 8): TopSite[] {
  const cached = topSitesCache;
  if (cached && cached.limit === limit && Date.now() - cached.at < TOP_SITES_TTL_MS) return cached.sites;
  const sites = computeTopSites(limit);
  topSitesCache = { at: Date.now(), limit, sites };
  return sites;
}

function computeTopSites(limit: number): TopSite[] {
  getStore();
  const now = Date.now();
  const best = new Map<string, { entry: HistoryEntry; score: number; hostScore: number; hostVisits: number }>();
  for (const entry of byUrl.values()) {
    const f = fieldsOf(entry);
    if (SEARCH_RESULT_PAGE.test(f.bare)) continue;
    const score = frecency(entry, now);
    const current = best.get(f.host);
    if (!current) {
      best.set(f.host, { entry, score, hostScore: score, hostVisits: entry.visits });
      continue;
    }
    current.hostScore += score;
    current.hostVisits += entry.visits;
    if (score > current.score) {
      current.entry = entry;
      current.score = score;
    }
  }
  return [...best.values()]
    .sort((a, b) => b.hostScore - a.hostScore)
    .slice(0, Math.max(0, limit))
    .map(({ entry, hostVisits }): TopSite => {
      const host = fieldsOf(entry).host.replace(/:\d+$/, '');
      const site: TopSite = { url: entry.url, title: entry.title || host, visits: hostVisits };
      const favicon = faviconFor(host);
      if (favicon) site.favicon = favicon;
      return site;
    });
}

/** Newest first; `query` tokens must all match url or title; `before` is an exclusive lastVisit cursor. */
export function listHistory(query: string, limit: number, before?: number): HistoryListEntry[] {
  getStore();
  if (limit <= 0) return [];
  const tokens = query
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/\s+/)
    .filter(Boolean);
  const cursor = typeof before === 'number' && Number.isFinite(before) ? before : Infinity;

  const matches: HistoryEntry[] = [];
  outer: for (const entry of byUrl.values()) {
    if (entry.lastVisit >= cursor) continue;
    if (tokens.length > 0) {
      const f = fieldsOf(entry);
      for (const t of tokens) {
        if (!f.bare.includes(t) && !f.title.includes(t)) continue outer;
      }
    }
    matches.push(entry);
  }
  matches.sort((a, b) => b.lastVisit - a.lastVisit);
  return matches.slice(0, limit).map((entry): HistoryListEntry => {
    const result: HistoryListEntry = {
      url: entry.url,
      title: entry.title,
      visits: entry.visits,
      lastVisit: entry.lastVisit,
    };
    const favicon = faviconFor(fieldsOf(entry).host.replace(/:\d+$/, ''));
    if (favicon) result.favicon = favicon;
    return result;
  });
}

export function deleteHistoryEntry(url: string): void {
  const s = getStore();
  if (!byUrl.delete(stripHash(url))) return;
  topSitesCache = null;
  s.set([...byUrl.values()]);
}

/** Merges visits from another device (sync): newest title wins, counts and times take the max. */
export function mergeSyncedHistory(entries: readonly HistoryEntry[]): void {
  const s = getStore();
  let changed = false;
  for (const incoming of entries) {
    if (!/^https?:\/\//i.test(incoming.url)) continue;
    const key = stripHash(incoming.url);
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { url: key, title: incoming.title.slice(0, 300), visits: Math.max(1, Math.round(incoming.visits)), lastVisit: incoming.lastVisit });
      changed = true;
      continue;
    }
    const newer = incoming.lastVisit > existing.lastVisit;
    if (!newer && incoming.visits <= existing.visits) continue;
    if (newer && incoming.title && incoming.title !== existing.title) {
      existing.title = incoming.title.slice(0, 300);
      fields.delete(existing);
    }
    existing.visits = Math.max(existing.visits, Math.round(incoming.visits));
    existing.lastVisit = Math.max(existing.lastVisit, incoming.lastVisit);
    changed = true;
  }
  if (!changed) return;
  evictIfNeeded();
  topSitesCache = null;
  s.set([...byUrl.values()]);
}

export function clearHistory(): void {
  const s = getStore();
  byUrl.clear();
  topSitesCache = null;
  s.set([]);
  clearFavicons();
}
