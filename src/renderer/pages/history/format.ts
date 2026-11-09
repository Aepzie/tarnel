import type { HistoryEntry } from '@shared/types';

export interface DayGroup {
  key: string;
  label: string;
  entries: HistoryEntry[];
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const DAY_FORMAT_YEAR = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function dayLabel(dayStart: number, now = Date.now()): string {
  const today = startOfDay(now);
  if (dayStart === today) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayStart === yesterday.getTime()) return 'Yesterday';
  const sameYear = new Date(dayStart).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? DAY_FORMAT : DAY_FORMAT_YEAR).format(dayStart);
}

export function formatTime(time: number): string {
  return TIME_FORMAT.format(time);
}

/** Entries arrive newest first, so groups are built in a single pass. */
export function groupByDay(entries: readonly HistoryEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const now = Date.now();
  for (const entry of entries) {
    const dayStart = startOfDay(entry.lastVisit);
    const key = String(dayStart);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, label: dayLabel(dayStart, now), entries: [entry] });
  }
  return groups;
}

export function displayUrl(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, '');
    const path = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
    return { host, path };
  } catch {
    return { host: url, path: '' };
  }
}
