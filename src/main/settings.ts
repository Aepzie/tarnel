import { DEFAULT_SETTINGS, FRAME_RATE_MODES, MEMORY_SAVER_MODES, NEWTAB_HEROES, type FrameRateMode, type MemorySaverMode, type NewtabHero, type SearchEngine, type Settings, type TabLayout, type ThemeMode, type WindowMaterial } from '../shared/types';
import { BATTERY_SAVER_MODES, type BatterySaverMode } from '../shared/battery';
import { nextDnsTemplate, SECURE_DNS_MODES, validateDohTemplate, type SecureDnsMode } from '../shared/doh';
import { isValidUserAgent } from '../shared/user-agent';
import { MAX_ARCHIVE_AFTER_HOURS } from '../shared/tab-archive';
import { createStore, type JsonStore } from './store';

const SEARCH_ENGINES: readonly SearchEngine[] = ['duckduckgo', 'google', 'brave', 'startpage', 'ecosia'];
const THEMES: readonly ThemeMode[] = ['system', 'dark', 'light'];
const MATERIALS: readonly WindowMaterial[] = ['mica', 'acrylic', 'none'];
const TAB_LAYOUTS: readonly TabLayout[] = ['horizontal', 'vertical'];
const BOOLEAN_KEYS = [
  'adblock',
  'httpsOnly',
  'blockThirdPartyCookies',
  'sendDoNotTrack',
  'removeTrackingParams',
  'trimReferrers',
  'restoreSession',
  'sidebarCollapsed',
  'autoHideToolbar',
  'showBookmarksBar',
  'updateAutoCheck',
  'updateAutoDownload',
  'updatePrerelease',
  'preloadPages',
  'panicClearRecentHistory',
  'warnDangerousSites',
  'secureDnsStrict',
  'offerToSavePasswords',
  'passwordAutofill',
  'peekOnShiftClick',
  'newtabPrivacyStat',
  'privacyWeeklySummary',
] as const satisfies readonly (keyof Settings)[];

const listeners = new Set<(settings: Settings) => void>();
let store: JsonStore<Settings> | null = null;

function clampInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Returns a fully valid Settings object built from `base` with valid fields of `patch` applied. */
function sanitize(base: Settings, patch: Partial<Record<keyof Settings, unknown>>): Settings {
  const next: Settings = { ...base };
  if (SEARCH_ENGINES.includes(patch.searchEngine as SearchEngine)) next.searchEngine = patch.searchEngine as SearchEngine;
  if (THEMES.includes(patch.theme as ThemeMode)) next.theme = patch.theme as ThemeMode;
  if (MATERIALS.includes(patch.windowMaterial as WindowMaterial)) next.windowMaterial = patch.windowMaterial as WindowMaterial;
  if (NEWTAB_HEROES.includes(patch.newtabHero as NewtabHero)) next.newtabHero = patch.newtabHero as NewtabHero;
  if (TAB_LAYOUTS.includes(patch.tabLayout as TabLayout)) next.tabLayout = patch.tabLayout as TabLayout;
  if (FRAME_RATE_MODES.includes(patch.frameRate as FrameRateMode)) next.frameRate = patch.frameRate as FrameRateMode;
  for (const key of BOOLEAN_KEYS) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key];
  }
  if (SECURE_DNS_MODES.includes(patch.secureDns as SecureDnsMode)) next.secureDns = patch.secureDns as SecureDnsMode;
  if (patch.secureDnsNextDns === '' || nextDnsTemplate(patch.secureDnsNextDns)) next.secureDnsNextDns = (patch.secureDnsNextDns as string).trim();
  if (patch.secureDnsTemplate === '' || validateDohTemplate(patch.secureDnsTemplate)) next.secureDnsTemplate = (patch.secureDnsTemplate as string).trim();
  if (isValidUserAgent(patch.userAgent)) next.userAgent = patch.userAgent.trim();
  next.sleepAfterMinutes = clampInt(patch.sleepAfterMinutes, 0, 240) ?? next.sleepAfterMinutes;
  next.freezeAfterMinutes = clampInt(patch.freezeAfterMinutes, 0, 240) ?? next.freezeAfterMinutes;
  if (typeof patch.archiveAfterHours === 'number' && Number.isFinite(patch.archiveAfterHours)) {
    next.archiveAfterHours = Math.min(MAX_ARCHIVE_AFTER_HOURS, Math.max(0, patch.archiveAfterHours));
  }
  if (MEMORY_SAVER_MODES.includes(patch.memorySaver as MemorySaverMode)) next.memorySaver = patch.memorySaver as MemorySaverMode;
  if (BATTERY_SAVER_MODES.includes(patch.batterySaver as BatterySaverMode)) next.batterySaver = patch.batterySaver as BatterySaverMode;
  next.memorySaverThresholdGB = clampInt(patch.memorySaverThresholdGB, 1, 64) ?? next.memorySaverThresholdGB;
  next.sidebarWidth = clampInt(patch.sidebarWidth, 180, 420) ?? next.sidebarWidth;
  return next;
}

function getStore(): JsonStore<Settings> {
  if (!store) {
    store = createStore<Settings>('settings', { ...DEFAULT_SETTINGS });
    // Repair anything invalid that was persisted (hand-edited file, older versions).
    const repaired = sanitize(DEFAULT_SETTINGS, store.get());
    if (JSON.stringify(repaired) !== JSON.stringify(store.get())) store.set(repaired);
  }
  return store;
}

export function getSettings(): Settings {
  return getStore().get();
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const s = getStore();
  const current = s.get();
  const next = sanitize(current, (patch ?? {}) as Partial<Record<keyof Settings, unknown>>);
  if (JSON.stringify(next) === JSON.stringify(current)) return current;
  s.set(next);
  for (const cb of listeners) {
    try {
      cb(next);
    } catch {
      /* a faulty listener must not break others */
    }
  }
  return next;
}

export function onSettingsChanged(cb: (settings: Settings) => void): void {
  listeners.add(cb);
}
