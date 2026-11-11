/**
 * Web panels: pinned web apps (chat, music, calendar) shown in a side view next to the page, picked
 * from a slim rail on the right edge. Every panel runs in its own persistent partition
 * (`persist:panel-<id>`), isolated from every browsing Space and from the other panels.
 * Pure: shared by main (validation, idle policy) and the UI; unit-tested in panels.test.ts.
 */

export const PANELS_IPC = {
  /** chrome: current list and runtime state, list edits. */
  list: 'panels:list',
  add: 'panels:add',
  update: 'panels:update',
  remove: 'panels:remove',
  /** The same four for vela://settings (ipcMain allows one handler per channel). */
  pageList: 'panels:page-list',
  pageAdd: 'panels:page-add',
  pageUpdate: 'panels:page-update',
  pageRemove: 'panels:page-remove',
  /** chrome only */
  toggle: 'panels:toggle',
  collapse: 'panels:collapse',
  setBounds: 'panels:set-bounds',
  reload: 'panels:reload',
  toggleMute: 'panels:toggle-mute',
  openAsTab: 'panels:open-as-tab',
  /** main -> chrome */
  state: 'panels-event:state',
} as const;

export const PANEL_MIN_WIDTH = 300;
export const PANEL_MAX_WIDTH = 900;
export const PANEL_DEFAULT_WIDTH = 420;
export const PANEL_MAX_COUNT = 20;
export const PANEL_NAME_MAX = 40;

/** Persisted panel definition. */
export interface WebPanel {
  id: string;
  name: string;
  url: string;
  width: number;
  /** Load with a mobile user agent (many web apps have a nicer narrow layout). */
  mobile: boolean;
  muted: boolean;
  /** Cached favicon (data: URL) so the rail shows it before the panel was ever loaded. */
  favicon: string | null;
}

/** Runtime state of one panel, as the chrome renders it. */
export interface PanelInfo extends WebPanel {
  /** A live renderer exists (opened at least once and not put to sleep since). */
  loaded: boolean;
  frozen: boolean;
  audible: boolean;
  /** Unread count parsed from the page title, e.g. "(3) WhatsApp". */
  badge: number;
}

export interface PanelsState {
  panels: PanelInfo[];
  /** The expanded panel, null when all are collapsed. */
  openId: string | null;
}

export interface PanelInput {
  name: string;
  url: string;
  mobile?: boolean;
}

export type PanelPatch = Partial<Pick<WebPanel, 'name' | 'url' | 'width' | 'mobile'>>;

export interface PanelSuggestion {
  name: string;
  url: string;
  mobile: boolean;
}

/** Suggestions in the add form: URLs only, icons are fetched from the site (no bundled logos). */
export const PANEL_SUGGESTIONS: readonly PanelSuggestion[] = [
  { name: 'WhatsApp', url: 'https://web.whatsapp.com/', mobile: false },
  { name: 'Telegram', url: 'https://web.telegram.org/', mobile: false },
  { name: 'Discord', url: 'https://discord.com/app', mobile: false },
  { name: 'Spotify', url: 'https://open.spotify.com/', mobile: false },
  { name: 'ChatGPT', url: 'https://chatgpt.com/', mobile: false },
  { name: 'Google Calendar', url: 'https://calendar.google.com/', mobile: true },
  { name: 'Notion', url: 'https://www.notion.so/', mobile: false },
];

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT_WIDTH;
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(width)));
}

/**
 * Normalises user input to an http(s) URL ("web.whatsapp.com" -> https://web.whatsapp.com/).
 * Returns null for anything else (file:, javascript:, vela:, garbage).
 */
export function normalizePanelUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^/:]+:\d+(\/|$)/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!parsed.hostname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** Display name fallback: the host without "www.". */
export function panelNameFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Unread count from titles like "(3) WhatsApp", "[12] Chat", "Inbox (5)"; 0 when none. */
export function badgeFromTitle(title: string): number {
  const match = /^\s*[([](\d{1,5})\+?[)\]]/.exec(title) ?? /[([](\d{1,5})\+?[)\]]\s*$/.exec(title);
  if (!match) return 0;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) ? count : 0;
}

export interface PanelIdleCandidate {
  /** When the panel was collapsed; null while expanded. */
  collapsedAt: number | null;
  loaded: boolean;
  frozen: boolean;
  audible: boolean;
}

export type PanelIdleAction = 'freeze' | 'sleep' | null;

/**
 * What the idle policy does to a collapsed panel now. Mirrors the tab policy (perf/freeze.ts,
 * perf/sleeper.ts): freeze after `freezeMs`, sleep (destroy the renderer, the partition keeps the
 * login) after `sleepMs`; 0 disables a stage; an audible panel (music playing) is never touched.
 */
export function panelIdleAction(panel: PanelIdleCandidate, now: number, freezeMs: number, sleepMs: number): PanelIdleAction {
  if (panel.collapsedAt === null || !panel.loaded || panel.audible) return null;
  const idle = now - panel.collapsedAt;
  if (sleepMs > 0 && idle >= sleepMs) return 'sleep';
  if (freezeMs > 0 && !panel.frozen && idle >= freezeMs && (sleepMs <= 0 || freezeMs < sleepMs)) return 'freeze';
  return null;
}

/** Ms until the next idle stage of a collapsed panel is due; null when nothing is pending. */
export function panelNextDeadline(panel: PanelIdleCandidate, now: number, freezeMs: number, sleepMs: number): number | null {
  if (panel.collapsedAt === null || !panel.loaded) return null;
  const idle = now - panel.collapsedAt;
  const stages: number[] = [];
  if (freezeMs > 0 && !panel.frozen && (sleepMs <= 0 || freezeMs < sleepMs)) stages.push(freezeMs);
  if (sleepMs > 0) stages.push(sleepMs);
  const pending = stages.filter((stage) => stage > idle).map((stage) => stage - idle);
  if (pending.length === 0) return stages.length > 0 ? 0 : null;
  return Math.min(...pending);
}
