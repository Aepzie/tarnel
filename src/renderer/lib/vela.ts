import type { VelaChromeAPI, VelaPagesAPI } from '@shared/ipc';
import type { SpaceColor, ThemeMode } from '@shared/types';

export type { VelaChromeAPI, VelaPagesAPI };

/** Browser chrome bridge (only defined in the chrome window). */
export const vela = (): VelaChromeAPI => window.vela;
/** Internal-pages bridge (only defined on tarnel:// pages). */
export const velaPages = (): VelaPagesAPI => window.velaPages;

/** Internal pages live on tarnel://; vela:// is the legacy alias main maps to the same page. */
const INTERNAL_PROTOCOLS = new Set(['tarnel:', 'vela:']);

/** True for a URL protocol (with trailing colon) of an internal page, current or legacy. */
export function isInternalProtocol(protocol: string): boolean {
  return INTERNAL_PROTOCOLS.has(protocol.toLowerCase());
}

/** True for tarnel:// (or legacy vela://) URLs. */
export function isInternalUrl(url: string): boolean {
  return /^(tarnel|vela):\/\//i.test(url);
}

/** True for the new-tab page under either scheme. */
export function isNewTabUrl(url: string): boolean {
  return /^(tarnel|vela):\/\/newtab/i.test(url);
}

const noop = (): void => {};

/** Fire-and-forget a vela IPC call: swallow rejections (main busy / shutting down). */
export function settle(promise: Promise<unknown> | undefined): void {
  void promise?.catch(noop);
}

/** Address text to seed the palette with for a tab URL (empty for the new-tab page). */
export function addressSeed(url: string | undefined): string {
  if (!url || isNewTabUrl(url) || url === 'about:blank') return '';
  return url;
}

export const SPACE_HEX: Record<SpaceColor, string> = {
  slate: '#94a3b8',
  blue: '#60a5fa',
  violet: '#a78bfa',
  pink: '#f472b6',
  red: '#f87171',
  orange: '#fb923c',
  green: '#4ade80',
  teal: '#2dd4bf',
};

/** Sets <html> theme class + the animated accent color. */
export function applyTheme(theme: ThemeMode, accent?: SpaceColor): void {
  const root = document.documentElement;
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const light = theme === 'light' || (theme === 'system' && prefersLight);
  root.classList.toggle('light', light);
  root.classList.toggle('dark', !light);
  root.dataset.theme = light ? 'light' : 'dark';
  if (accent) root.style.setProperty('--accent-space', SPACE_HEX[accent]);
}

export function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    if (isInternalProtocol(parsed.protocol)) return `tarnel://${parsed.hostname}`;
    if (parsed.protocol === 'file:') return decodeURIComponent(parsed.pathname.split('/').pop() ?? '') || 'file';
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Favicon fallback: first meaningful letter of the host. */
export function letterOf(url: string, title = ''): string {
  const host = hostOf(url);
  const source = host && !host.startsWith('tarnel://') ? host : title;
  return (source.trim()[0] ?? '•').toUpperCase();
}

export function formatBytesMB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
