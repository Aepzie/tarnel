import { nativeTheme, webContents, type WebContents, type WebContentsView } from 'electron';
import { IPC } from '../shared/ipc';
import type { SpaceColor, ThemeMode } from '../shared/types';
import { getSettings, onSettingsChanged } from './settings';
import { getSpace, onSpacesChanged } from './spaces';
import * as tabs from './tabs';

/**
 * One theme for the whole workspace. `nativeTheme.themeSource` follows the Tarnel theme setting, so
 * prefers-color-scheme, native menus, the Mica/Acrylic backdrop and the window background all agree
 * with the chrome; open tarnel:// pages get the theme + their Space accent pushed live (no reload).
 */

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

/** Flat page backdrops; match `--background` in globals.css (dark / light). */
export const BACKDROP_DARK = '#09090b';
export const BACKDROP_LIGHT = '#fafafa';
const WEB_BACKDROP = '#ffffff';

export interface PageTheme {
  theme: 'dark' | 'light';
  mode: ThemeMode;
  accent: string | null;
  hero: string;
}

export function isDarkTheme(): boolean {
  return nativeTheme.shouldUseDarkColors;
}

export function themeBackdrop(): string {
  return isDarkTheme() ? BACKDROP_DARK : BACKDROP_LIGHT;
}

/** Theme + Space accent for the tarnel:// page hosted in `wc` (accent is null outside a tab). */
export function pageThemeFor(wc: WebContents): PageTheme {
  const { theme, newtabHero } = getSettings();
  const tabId = tabs.tabIdForWebContents(wc.id);
  const spaceId = tabId === null ? null : tabs.getTabSpaceId(tabId);
  const space = spaceId ? getSpace(spaceId) : undefined;
  return {
    theme: isDarkTheme() ? 'dark' : 'light',
    mode: theme,
    accent: space ? SPACE_HEX[space.color] : null,
    hero: newtabHero,
  };
}

const isInternalPageUrl = (url: string): boolean => url.startsWith('tarnel://');

/** Last payload sent per webContents, so frequent state changes cost nothing when nothing changed. */
const lastSent = new Map<number, string>();

function pushToPages(): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed() || !isInternalPageUrl(wc.getURL()) || tabs.tabIdForWebContents(wc.id) === null) continue;
    const payload = pageThemeFor(wc);
    const key = JSON.stringify(payload);
    if (lastSent.get(wc.id) === key) continue;
    lastSent.set(wc.id, key);
    wc.send(IPC.pagesEvents.theme, payload);
  }
}

let pushQueued = false;
function schedulePush(): void {
  if (pushQueued) return;
  pushQueued = true;
  setImmediate(() => {
    pushQueued = false;
    pushToPages();
  });
}

/**
 * Before first paint a tab view shows its own background: themed for tarnel:// pages (no white flash
 * on a dark new tab), white for the web (sites without a background expect white).
 */
export function attachViewBackdrop(view: WebContentsView, initialUrl: string): void {
  const wc = view.webContents;
  const apply = (url: string): void => {
    if (!view.webContents.isDestroyed()) view.setBackgroundColor(isInternalPageUrl(url) ? themeBackdrop() : WEB_BACKDROP);
  };
  apply(initialUrl);
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) apply(details.url);
  });
  wc.on('dom-ready', () => lastSent.delete(wc.id));
  wc.once('destroyed', () => lastSent.delete(wc.id));
  views.add(view);
  wc.once('destroyed', () => views.delete(view));
}

const views = new Set<WebContentsView>();

function refreshViewBackdrops(): void {
  for (const view of views) {
    const wc = view.webContents;
    if (!wc.isDestroyed() && isInternalPageUrl(wc.getURL())) view.setBackgroundColor(themeBackdrop());
  }
}

export function initPageTheme(onWindowTheme: () => void): void {
  nativeTheme.themeSource = getSettings().theme;
  onSettingsChanged((settings) => {
    if (nativeTheme.themeSource !== settings.theme) nativeTheme.themeSource = settings.theme;
    schedulePush();
  });
  nativeTheme.on('updated', () => {
    refreshViewBackdrops();
    onWindowTheme();
    schedulePush();
  });
  onSpacesChanged(schedulePush);
  tabs.onStateChanged(schedulePush);
}
