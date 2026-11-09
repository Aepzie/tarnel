import { powerMonitor } from 'electron';
import os from 'node:os';

/**
 * Tab sleeping. A sleeping tab has its renderer process destroyed (not merely frozen), so its
 * memory is returned to the OS; it is recreated from the saved URL when activated again.
 */

export interface SleepCandidate {
  id: number;
  lastActiveAt: number;
  audible: boolean;
  pinned: boolean;
  asleep: boolean;
  active: boolean;
}

export interface SleeperDeps {
  listTabs(): SleepCandidate[];
  sleepTab(id: number): void;
  getSleepAfterMinutes(): number;
}

const TICK_MS = 30_000;
const LOW_MEMORY_RATIO = 0.1;
/** Under memory pressure, never sleep a tab the user left less than a minute ago. */
const PRESSURE_MIN_IDLE_MS = 60_000;
/** Cap per tick so a pressure spike doesn't wipe every background tab at once. */
const PRESSURE_MAX_PER_TICK = 2;

let timer: NodeJS.Timeout | null = null;
let onBattery = false;
const onBatteryListener = (): void => {
  onBattery = true;
};
const onAcListener = (): void => {
  onBattery = false;
};

function isEligible(tab: SleepCandidate): boolean {
  return !tab.active && !tab.asleep && !tab.audible && !tab.pinned;
}

function underMemoryPressure(): boolean {
  const total = os.totalmem();
  return total > 0 && os.freemem() / total < LOW_MEMORY_RATIO;
}

function tick(deps: SleeperDeps): void {
  const minutes = deps.getSleepAfterMinutes();
  if (!(minutes > 0)) return; // 0 = user opted out of sleeping entirely

  // On battery, halve the timeout: every awake renderer costs timers, GC and wakeups.
  const timeoutMs = (minutes * 60_000) / (onBattery ? 2 : 1);
  const now = Date.now();
  const candidates = deps.listTabs().filter(isEligible);
  const slept = new Set<number>();

  for (const tab of candidates) {
    if (now - tab.lastActiveAt > timeoutMs) {
      deps.sleepTab(tab.id);
      slept.add(tab.id);
    }
  }

  if (!underMemoryPressure()) return;
  const oldestFirst = candidates
    .filter((tab) => !slept.has(tab.id) && now - tab.lastActiveAt > PRESSURE_MIN_IDLE_MS)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    .slice(0, PRESSURE_MAX_PER_TICK);
  for (const tab of oldestFirst) deps.sleepTab(tab.id);
}

export function initSleeper(deps: SleeperDeps): void {
  stopSleeper();
  try {
    onBattery = powerMonitor.isOnBatteryPower();
    powerMonitor.on('on-battery', onBatteryListener);
    powerMonitor.on('on-ac', onAcListener);
  } catch {
    onBattery = false; // powerMonitor unavailable (e.g. before ready): assume AC
  }
  timer = setInterval(() => {
    try {
      tick(deps);
    } catch (err) {
      console.error('[sleeper] tick failed', err);
    }
  }, TICK_MS);
  timer.unref(); // never keep the process alive just for the sleeper
}

export function stopSleeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
  try {
    powerMonitor.removeListener('on-battery', onBatteryListener);
    powerMonitor.removeListener('on-ac', onAcListener);
  } catch {
    /* powerMonitor not usable before app ready; nothing was registered */
  }
}
