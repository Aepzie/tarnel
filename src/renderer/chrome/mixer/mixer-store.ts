import { useSyncExternalStore } from 'react';
import { DEFAULT_TAB_AUDIO, type MixerTabState, type TabAudioSettings } from '@shared/audio-mixer';
import type { BrowserState, TabState } from '@shared/types';
import { getBrowserStateSnapshot } from '@/hooks/browser';
import { settle } from '@/lib/vela';
import { createMockMixer, isMissingHandler, type MixerApi, type MockMixer } from './mock';

/**
 * Chrome-side mixer state: per-tab settings + routing mirrored from main (optimistic while the user
 * drags), panel open/selection, and solo. Levels are not here (see levels.ts) so meters never
 * re-render React.
 */
export interface MixerSnapshot {
  tabs: ReadonlyMap<number, MixerTabState>;
  open: boolean;
  selectedId: number | null;
  soloId: number | null;
  /** Dev mock only: tabs it pretends are playing. */
  simulated: readonly number[];
  mock: boolean;
  /** Connected to main (or the mock): levels can be watched. */
  ready: boolean;
}

/** Throttle for live `set` IPC while a control is dragged (leading + trailing). */
const SEND_INTERVAL_MS = 40;
/** Pushes from main within this window after a local edit keep the local settings (no jitter). */
const LOCAL_WINS_MS = 500;

let snapshot: MixerSnapshot = { tabs: new Map(), open: false, selectedId: null, soloId: null, simulated: [], mock: false, ready: false };
const listeners = new Set<() => void>();
let api: MixerApi | null = null;
let mock: MockMixer | null = null;
let started = false;
const editedAt = new Map<number, number>();
const pending = new Map<number, Partial<TabAudioSettings>>();
const timers = new Map<number, number>();
let soloMuted: number[] = [];

function emit(next: Partial<MixerSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

function merge(incoming: readonly MixerTabState[], replace: boolean): void {
  const now = performance.now();
  const tabs = new Map(replace ? [] : snapshot.tabs);
  for (const state of incoming) {
    const local = snapshot.tabs.get(state.tabId);
    const recent = now - (editedAt.get(state.tabId) ?? -Infinity) < LOCAL_WINS_MS || pending.has(state.tabId);
    tabs.set(state.tabId, recent && local ? { ...state, settings: local.settings } : state);
  }
  emit({ tabs, simulated: mock?.audible() ?? [] });
}

function attach(next: MixerApi, initial: readonly MixerTabState[] | null): void {
  api = next;
  emit({ ready: true });
  next.onState((tabs) => merge(tabs, true));
  if (initial) merge(initial, true);
  else next.get().then((tabs) => merge(tabs, true), () => undefined);
}

/** Connect to main; falls back to the dev mock only while main has no mixer handlers at all. */
function start(): void {
  if (started || !window.vela?.mixer) return;
  started = true;
  const real = window.vela.mixer;
  real.get().then(
    (tabs) => attach(real, tabs),
    (error: unknown) => {
      if (!isMissingHandler(error)) {
        attach(real, []);
        return;
      }
      mock = createMockMixer(() => emit({ simulated: mock?.audible() ?? [] }));
      emit({ mock: true });
      attach(mock.api, null);
    },
  );
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMixer(): MixerSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function mixerApi(): MixerApi | null {
  return api;
}

export function settingsOf(tabId: number): TabAudioSettings {
  return snapshot.tabs.get(tabId)?.settings ?? DEFAULT_TAB_AUDIO;
}

function flush(tabId: number): void {
  const patch = pending.get(tabId);
  if (!patch || !api) {
    timers.delete(tabId);
    return;
  }
  pending.delete(tabId);
  api.set(tabId, patch).then((state) => merge([state], false), () => undefined);
  timers.set(
    tabId,
    window.setTimeout(() => {
      timers.delete(tabId);
      if (pending.has(tabId)) flush(tabId);
    }, SEND_INTERVAL_MS),
  );
}

/** Apply `patch` locally right away and stream it to main (throttled). */
export function updateTab(tabId: number, patch: Partial<TabAudioSettings>): void {
  const current = snapshot.tabs.get(tabId);
  const settings = { ...(current?.settings ?? DEFAULT_TAB_AUDIO), ...patch };
  const tabs = new Map(snapshot.tabs);
  tabs.set(tabId, { tabId, routing: current?.routing ?? 'idle', settings });
  editedAt.set(tabId, performance.now());
  emit({ tabs });
  pending.set(tabId, { ...pending.get(tabId), ...patch });
  if (!timers.has(tabId)) flush(tabId);
}

export function resetTab(tabId: number): void {
  const current = snapshot.tabs.get(tabId);
  const tabs = new Map(snapshot.tabs);
  tabs.set(tabId, { tabId, routing: current?.routing ?? 'idle', settings: DEFAULT_TAB_AUDIO });
  pending.delete(tabId);
  editedAt.set(tabId, performance.now());
  emit({ tabs });
  api?.reset(tabId).then((state) => merge([state], false), () => undefined);
}

/**
 * Tabs that get a channel strip: audible, muted, or with mixer settings / routing known to main,
 * in tab order. Pinned and grouped tabs are included; other Spaces too (sound does not care).
 */
export function channelTabs(state: BrowserState, mixer: MixerSnapshot): TabState[] {
  return state.tabs.filter(
    (tab) =>
      tab.audible ||
      tab.muted ||
      mixer.tabs.has(tab.id) ||
      mixer.simulated.includes(tab.id) ||
      tab.id === mixer.soloId,
  );
}

const toggleMute = (tabId: number): void => settle(window.vela.tabs.toggleMute(tabId));

/**
 * Solo: mute every other channel (through the regular tab mute) and remember which ones, so turning
 * solo off, or soloing another tab, unmutes exactly those again.
 */
export function toggleSolo(tabId: number): void {
  const state = getBrowserStateSnapshot();
  const isMuted = (id: number): boolean => !!state.tabs.find((tab) => tab.id === id)?.muted;
  for (const id of soloMuted) if (isMuted(id)) toggleMute(id);
  soloMuted = [];
  if (snapshot.soloId === tabId) {
    emit({ soloId: null });
    return;
  }
  const others = channelTabs(state, snapshot).filter((tab) => tab.id !== tabId && !tab.muted);
  others.forEach((tab) => toggleMute(tab.id));
  soloMuted = others.map((tab) => tab.id);
  if (isMuted(tabId)) toggleMute(tabId);
  emit({ soloId: tabId });
}

/** Drop solo bookkeeping when the soloed tab is gone (others stay as they are). */
export function forgetSolo(): void {
  soloMuted = [];
  emit({ soloId: null });
}

export const mixerPanel = {
  open: (): void => {
    start();
    if (!snapshot.open) emit({ open: true });
  },
  close: (): void => {
    if (snapshot.open) emit({ open: false });
  },
  toggle: (): void => {
    start();
    emit({ open: !snapshot.open });
  },
  setOpen: (open: boolean): void => {
    if (snapshot.open !== open) emit({ open });
  },
  select: (selectedId: number | null): void => {
    if (snapshot.selectedId !== selectedId) emit({ selectedId });
  },
  refresh: (): void => {
    api?.get().then((tabs) => merge(tabs, true), () => undefined);
  },
};
