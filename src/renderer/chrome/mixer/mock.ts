import {
  DEFAULT_TAB_AUDIO,
  type MixerRouting,
  type MixerTabState,
  type TabAudioLevel,
  type TabAudioSettings,
} from '@shared/audio-mixer';
import type { Unsubscribe, VelaChromeAPI } from '@shared/ipc';
import { getBrowserStateSnapshot } from '@/hooks/browser';
import { filtersOf, responseDb } from './eq-math';

export type MixerApi = VelaChromeAPI['mixer'];

/**
 * Development stand-in for the mixer engine. Only used when main has no mixer handlers registered
 * (`get` rejects with "No handler registered"), so it is inert as soon as the real engine exists.
 * Simulates the first N tabs of the window (N = localStorage `vela:mixer-mock-tabs`, default 3) with
 * animated levels and spectrum that react to the settings.
 */
export function isMissingHandler(error: unknown): boolean {
  return error instanceof Error && error.message.includes('No handler registered');
}

const ROUTINGS: readonly MixerRouting[] = ['full', 'partial', 'full', 'idle'];
const LEVEL_MS = 50;
const SPECTRUM_BINS = 16;

function mockCount(): number {
  try {
    const raw = Number(window.localStorage.getItem('vela:mixer-mock-tabs'));
    return Number.isFinite(raw) && raw > 0 ? Math.min(12, Math.round(raw)) : 3;
  } catch {
    return 3;
  }
}

export interface MockMixer {
  api: MixerApi;
  /** Tabs the mock pretends are playing (the activity indicator uses them). */
  audible(): number[];
}

export function createMockMixer(onChange: () => void): MockMixer {
  const settings = new Map<number, TabAudioSettings>();
  const routing = new Map<number, MixerRouting>();
  const stateListeners = new Set<(tabs: MixerTabState[]) => void>();
  const levelListeners = new Set<(levels: TabAudioLevel[]) => void>();
  let ids: number[] = [];
  let levelTimer: number | undefined;

  const snapshot = (): MixerTabState[] =>
    ids.map((tabId) => ({ tabId, settings: settings.get(tabId) ?? DEFAULT_TAB_AUDIO, routing: routing.get(tabId) ?? 'idle' }));

  const emit = (): void => {
    const tabs = snapshot();
    stateListeners.forEach((listener) => listener(tabs));
    onChange();
  };

  const sync = (): void => {
    const tabs = getBrowserStateSnapshot().tabs;
    const live = new Set(tabs.map((tab) => tab.id));
    const kept = ids.filter((tabId) => live.has(tabId));
    const wanted = mockCount();
    const fresh = tabs.filter((tab) => !kept.includes(tab.id)).slice(0, Math.max(0, wanted - kept.length));
    const next = [...kept, ...fresh.map((tab) => tab.id)].slice(0, wanted);
    if (next.length === ids.length && next.every((tabId, index) => tabId === ids[index])) return;
    ids = next;
    ids.forEach((tabId, index) => {
      if (!routing.has(tabId)) routing.set(tabId, ROUTINGS[index % ROUTINGS.length]!);
      if (!settings.has(tabId)) settings.set(tabId, structuredClone(DEFAULT_TAB_AUDIO));
    });
    emit();
  };
  window.setInterval(sync, 1000);

  const stateOf = (tabId: number): MixerTabState => ({
    tabId,
    settings: settings.get(tabId) ?? DEFAULT_TAB_AUDIO,
    routing: routing.get(tabId) ?? 'idle',
  });

  const levels = (): TabAudioLevel[] => {
    const time = performance.now() / 1000;
    const tabs = getBrowserStateSnapshot().tabs;
    return ids.map((tabId, index) => {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      const route = routing.get(tabId) ?? 'idle';
      const current = settings.get(tabId) ?? DEFAULT_TAB_AUDIO;
      if (!tab || tab.muted || route === 'idle') return { tabId, peakL: 0, peakR: 0, spectrum: [] };
      return synthesize(tabId, index, time, current, route);
    });
  };

  const api: MixerApi = {
    get: async () => {
      sync();
      return snapshot();
    },
    onState: (listener): Unsubscribe => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    set: async (tabId, patch) => {
      const base = settings.get(tabId) ?? DEFAULT_TAB_AUDIO;
      settings.set(tabId, { ...base, ...patch, bassBoost: { ...base.bassBoost, ...patch.bassBoost } });
      if (!ids.includes(tabId)) ids = [...ids, tabId];
      emit();
      return stateOf(tabId);
    },
    reset: async (tabId) => {
      settings.set(tabId, structuredClone(DEFAULT_TAB_AUDIO));
      emit();
      return stateOf(tabId);
    },
    watchLevels: async (on) => {
      window.clearInterval(levelTimer);
      levelTimer = undefined;
      if (!on) return;
      levelTimer = window.setInterval(() => {
        const next = levels();
        levelListeners.forEach((listener) => listener(next));
      }, LEVEL_MS);
    },
    onLevels: (listener): Unsubscribe => {
      levelListeners.add(listener);
      return () => levelListeners.delete(listener);
    },
  };

  return {
    api,
    audible: () => {
      const tabs = getBrowserStateSnapshot().tabs;
      return ids.filter((tabId) => routing.get(tabId) !== 'idle' && !tabs.find((tab) => tab.id === tabId)?.muted);
    },
  };
}

function binFrequency(bin: number): number {
  return 20 * 1000 ** ((bin + 0.5) / SPECTRUM_BINS);
}

/** A loose "song": kick on the beat, hats on the off-beat, a slowly breathing pad. */
function synthesize(tabId: number, index: number, time: number, settings: TabAudioSettings, route: MixerRouting): TabAudioLevel {
  const bps = (96 + index * 21) / 60;
  const beat = (time * bps + index * 0.37) % 1;
  const kick = Math.exp(-beat * 9);
  const hat = Math.exp(-((beat + 0.5) % 1) * 22);
  const breath = 0.5 + 0.5 * Math.sin(time * 0.6 + index);
  const filters = filtersOf(settings);
  const spectrum = Array.from({ length: SPECTRUM_BINS }, (_, bin) => {
    const tilt = 0.62 - bin * 0.026;
    const body = bin < 4 ? kick * (0.42 - bin * 0.07) : 0;
    const air = bin > 10 ? hat * 0.22 : 0;
    const pad = bin > 3 && bin < 11 ? breath * 0.12 : 0;
    const jitter = (Math.random() - 0.5) * 0.08;
    const boost = 10 ** (responseDb(filters, binFrequency(bin)) / 20);
    return Math.min(1, Math.max(0, (tilt + body + air + pad + jitter) * Math.sqrt(boost) * Math.min(1.4, settings.volume)));
  });
  const loudness = Math.min(1, (0.32 + kick * 0.42 + breath * 0.12 + Math.random() * 0.06) * settings.volume);
  const level = settings.compressor ? 0.42 + (loudness - 0.42) * 0.45 : loudness;
  const wobble = 0.06 * Math.sin(time * 3.1 + tabId);
  let left = Math.min(1, level * (1 + wobble) * Math.min(1, 1 - settings.balance));
  let right = Math.min(1, level * (1 - wobble) * Math.min(1, 1 + settings.balance));
  if (settings.mono) {
    left = (left + right) / 2;
    right = left;
  }
  return { tabId, peakL: left, peakR: right, spectrum: route === 'partial' ? [] : spectrum };
}
