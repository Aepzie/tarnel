import { useEffect, useSyncExternalStore } from 'react';
import type { BatterySaverState } from '@shared/battery';

/** Battery saver state pushed by main (perf/battery-saver.ts); one subscription for the whole chrome UI. */

let active = false;
let started = false;
const subscribers = new Set<() => void>();

function apply(state: BatterySaverState): void {
  if (state.active === active) return;
  active = state.active;
  for (const notify of subscribers) notify();
}

function start(): void {
  if (started) return;
  started = true;
  const battery = window.vela?.battery;
  if (!battery) return;
  battery.onChange(apply);
  battery.state().then(apply, () => undefined);
}

function subscribe(notify: () => void): () => void {
  start();
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

export function useBatterySaver(): boolean {
  return useSyncExternalStore(subscribe, () => active);
}

interface BatteryManagerLike extends EventTarget {
  level: number;
}

/**
 * Reports the battery level to main while the "Below 20 %" mode is selected. Electron has no level
 * API; Chromium's Battery Status API covers Windows, macOS and Linux (UPower). Unsupported → null.
 */
export function useBatteryLevelReport(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const battery = window.vela?.battery;
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }).getBattery;
    if (!battery) return;
    if (!getBattery) {
      void battery.report(null).catch(() => undefined);
      return;
    }
    let manager: BatteryManagerLike | null = null;
    let alive = true;
    const report = (): void => {
      if (alive && manager) void battery.report(manager.level).catch(() => undefined);
    };
    getBattery.call(navigator).then(
      (found) => {
        if (!alive) return;
        manager = found;
        manager.addEventListener('levelchange', report);
        report();
      },
      () => void battery.report(null).catch(() => undefined),
    );
    return () => {
      alive = false;
      manager?.removeEventListener('levelchange', report);
    };
  }, [enabled]);
}
