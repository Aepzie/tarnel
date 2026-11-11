import type { PrivacyCounts } from '@shared/privacy-report';

export const count = (counts: PrivacyCounts, key: string): number => counts[key] ?? 0;

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${Math.round(bytes)} B`;
}

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

/** "+12% vs last week" / "−4% vs last week" / null when there is nothing to compare with. */
export function trend(current: number, previous: number): { label: string; up: boolean } | null {
  if (previous <= 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return { label: 'Same as last week', up: false };
  return { label: `${change > 0 ? '+' : '−'}${Math.abs(change)}% vs last week`, up: change > 0 };
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const LONG_DATE = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function dateOf(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export const weekdayOf = (day: string): string => WEEKDAY.format(dateOf(day));
export const longDateOf = (day: string): string => LONG_DATE.format(dateOf(day));
