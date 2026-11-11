import type { SpaceColor, SpaceId } from './types';

/**
 * Tab archive: tabs unused for a while (or archived by hand) leave the tab strip and land in a
 * per-Space archive instead of being lost. Pure helpers here are shared by main and the chrome UI.
 */

export const TAB_ARCHIVE_IPC = {
  list: 'chrome:tab-archive-list',
  archiveTabs: 'chrome:tab-archive-tabs',
  archiveGroup: 'chrome:tab-archive-group',
  restore: 'chrome:tab-archive-restore',
  remove: 'chrome:tab-archive-remove',
  clear: 'chrome:tab-archive-clear',
  reopenClosed: 'chrome:tab-archive-reopen-closed',
  changed: 'chrome-event:tab-archive',
} as const;

/** Options offered in Settings → Performance (hours; 0 = off). */
export const ARCHIVE_AFTER_HOURS_OPTIONS = [0, 6, 12, 24, 72, 168] as const;
export const DEFAULT_ARCHIVE_AFTER_HOURS = 24;
/** Upper bound accepted from settings (one week). */
export const MAX_ARCHIVE_AFTER_HOURS = 168;
/** Entries kept per Space; the oldest drop off first. */
export const MAX_ARCHIVED_PER_SPACE = 500;

export interface ArchivedGroup {
  id: string;
  name: string;
  color: SpaceColor;
}

export interface ArchivedTab {
  id: string;
  spaceId: SpaceId;
  url: string;
  title: string;
  favicon: string | null;
  group?: ArchivedGroup;
  archivedAt: number;
  reason: 'auto' | 'manual';
}

export interface ClosedTabEntry {
  id: string;
  spaceId: SpaceId;
  url: string;
  title: string;
  favicon: string | null;
  closedAt: number;
}

export interface TabArchiveSnapshot {
  spaceId: SpaceId;
  /** Newest first. */
  archived: ArchivedTab[];
  /** Recently closed tabs of the Space, newest first. */
  closed: ClosedTabEntry[];
}

/** Newest first, capped. `incoming` replaces entries with the same URL (re-archiving a page moves it to the top). */
export function addArchived(list: readonly ArchivedTab[], incoming: readonly ArchivedTab[], max = MAX_ARCHIVED_PER_SPACE): ArchivedTab[] {
  const urls = new Set(incoming.map((entry) => entry.url));
  const merged = [...incoming].sort((a, b) => b.archivedAt - a.archivedAt).concat(list.filter((entry) => !urls.has(entry.url)));
  return merged.slice(0, Math.max(0, max));
}

export function removeArchived(list: readonly ArchivedTab[], ids: ReadonlySet<string>): ArchivedTab[] {
  return list.filter((entry) => !ids.has(entry.id));
}

export function searchArchived<T extends { title: string; url: string }>(list: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...list];
  return list.filter((entry) => entry.title.toLowerCase().includes(needle) || entry.url.toLowerCase().includes(needle));
}

/** Local calendar day key (YYYY-MM-DD) of a timestamp. */
export function dayKey(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface ArchiveDay<T> {
  key: string;
  entries: T[];
}

/** Groups entries (already newest first) by local day, keeping order. */
export function groupByDay<T>(list: readonly T[], timeOf: (entry: T) => number): ArchiveDay<T>[] {
  const days: ArchiveDay<T>[] = [];
  for (const entry of list) {
    const key = dayKey(timeOf(entry));
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else days.push({ key, entries: [entry] });
  }
  return days;
}

/** "Today", "Yesterday", weekday within a week, otherwise a short date. */
export function dayLabel(key: string, now: number): string {
  if (key === dayKey(now)) return 'Today';
  if (key === dayKey(now - 86_400_000)) return 'Yesterday';
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  if (now - date.getTime() < 7 * 86_400_000) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function relativeAge(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export interface TabArchiveAPI {
  /** Archive and closed list of a Space (default: the active Space). */
  list(spaceId?: SpaceId): Promise<TabArchiveSnapshot>;
  /** Move tabs into their Space's archive (pinned tabs are skipped). */
  archiveTabs(tabIds: number[]): Promise<number>;
  archiveGroup(groupId: string): Promise<number>;
  /** Reopen archived entries (in their Space, back into their group when possible); removes them from the archive. */
  restore(ids: string[], spaceId?: SpaceId): Promise<number>;
  remove(ids: string[], spaceId?: SpaceId): Promise<void>;
  clear(spaceId?: SpaceId): Promise<void>;
  reopenClosed(id: string): Promise<void>;
  onChange(cb: (spaceId: SpaceId) => void): () => void;
}

declare module './ipc' {
  interface VelaChromeAPI {
    tabArchive: TabArchiveAPI;
  }
}
