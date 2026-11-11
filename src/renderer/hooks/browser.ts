import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BrowserState, PerfStats, Settings, Space, TabGroup, TabState, UICommand } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';
import { isLoneStartPage } from '@shared/tab-close';

/* ------------------------------------------------------------------------------------------------
 * Single IPC subscription for the browser chrome. Components select slices with the hooks below.
 * ---------------------------------------------------------------------------------------------- */

const EMPTY_STATE: BrowserState = { tabs: [], activeTabId: null, spaces: [], activeSpaceId: '', groups: [], splits: [] };

let browserState: BrowserState = EMPTY_STATE;
let settingsState: Settings = DEFAULT_SETTINGS;
const stateListeners = new Set<() => void>();
const settingsListeners = new Set<() => void>();
let started = false;

function start(): void {
  if (started || !window.vela) return;
  started = true;
  window.vela.onState((next) => {
    browserState = next;
    stateListeners.forEach((cb) => cb());
  });
  window.vela.settings.onChange((next) => {
    settingsState = next;
    settingsListeners.forEach((cb) => cb());
  });
  void window.vela.getState().then((next) => {
    browserState = next;
    stateListeners.forEach((cb) => cb());
  });
  void window.vela.settings.get().then((next) => {
    settingsState = next;
    settingsListeners.forEach((cb) => cb());
  });
}

export function useBrowserState(): BrowserState {
  start();
  return useSyncExternalStore(
    (cb) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    () => browserState,
  );
}

function subscribeState(cb: () => void): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

/**
 * Subscribe to a derived slice of browser state. The component only re-renders when `isEqual`
 * reports a change, so frequent pushes (blocked counters, loading flags) don't fan out everywhere.
 */
export function useBrowserSlice<T>(selector: (state: BrowserState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  start();
  const selectorRef = useRef(selector);
  const equalRef = useRef(isEqual);
  selectorRef.current = selector;
  equalRef.current = isEqual;
  const cache = useRef<{ source: BrowserState; value: T } | null>(null);
  const getSnapshot = useCallback((): T => {
    const prev = cache.current;
    if (prev && prev.source === browserState) return prev.value;
    const next = selectorRef.current(browserState);
    if (prev && equalRef.current(prev.value, next)) {
      cache.current = { source: browserState, value: prev.value };
      return prev.value;
    }
    cache.current = { source: browserState, value: next };
    return next;
  }, []);
  return useSyncExternalStore(subscribeState, getSnapshot);
}

/** Shallow equality for arrays and plain objects (one level). */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function useSettings(): Settings {
  start();
  return useSyncExternalStore(
    (cb) => {
      settingsListeners.add(cb);
      return () => settingsListeners.delete(cb);
    },
    () => settingsState,
  );
}

export function getBrowserStateSnapshot(): BrowserState {
  return browserState;
}

export function useActiveSpace(): Space | undefined {
  return useBrowserSlice((s) => s.spaces.find((space) => space.id === s.activeSpaceId));
}

/** Tabs of the active space, pinned first (main already orders them). Stable while tabs are unchanged. */
export function useSpaceTabs(): TabState[] {
  return useBrowserSlice((s) => s.tabs.filter((t) => t.spaceId === s.activeSpaceId), shallowEqual);
}

function sameGroups(a: TabGroup[], b: TabGroup[]): boolean {
  return a.length === b.length && a.every((group, i) => shallowEqual(group, b[i]));
}

/** Tab groups of the active space in display order. Stable while no group changed. */
export function useSpaceGroups(): TabGroup[] {
  return useBrowserSlice((s) => s.groups.filter((g) => g.spaceId === s.activeSpaceId), sameGroups);
}

/** False for the start page that is the only tab of its space (main ignores closing it). */
export function useTabClosable(tab: TabState): boolean {
  return useBrowserSlice((s) => !isLoneStartPage(tab, s.tabs));
}

export function useActiveTab(): TabState | undefined {
  return useBrowserSlice((s) => s.tabs.find((t) => t.id === s.activeTabId));
}

/** Subscribe to main-process UI commands (shortcuts). */
export function useCommand(handler: (command: UICommand) => void): void {
  useEffect(() => window.vela?.onCommand(handler), [handler]);
}

/** Polls perf stats every `intervalMs` while the window is visible; `null` pauses (keeps the last stats). */
export function usePerf(intervalMs: number | null = 5000): PerfStats | null {
  const [stats, setStats] = useState<PerfStats | null>(null);
  useEffect(() => {
    if (intervalMs === null) return;
    let timer: number | undefined;
    let alive = true;
    const tick = async (): Promise<void> => {
      if (document.visibilityState === 'visible') {
        try {
          const next = await window.vela.perf.get();
          if (alive) setStats(next);
        } catch {
          /* main busy / shutting down */
        }
      }
      if (alive) timer = window.setTimeout(tick, intervalMs);
    };
    void tick();
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible' || !alive) return;
      window.clearTimeout(timer);
      void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return stats;
}
