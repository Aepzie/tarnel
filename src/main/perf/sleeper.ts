import { app, type Session, type WebContents } from 'electron';
import os from 'node:os';
import type { MemorySaverMode } from '../../shared/types';
import { pickFreezeTargets } from './freeze';
import { estimateTabMemoryKB, pickSaverTargets } from './memory-saver';
import { committedMemoryKB } from './metrics';
import { isBatterySaverActive } from './battery-saver';
import { batteryDelayDivisor, effectiveMemorySaver } from './battery-policy';

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
  frozen: boolean;
  /** Microphone/camera granted and in use (audio-devices state). */
  capturing: boolean;
  /** Renderer processes hosting the tab's frames (memory saver estimate). */
  pids: number[];
}

export interface SleeperDeps {
  listTabs(): SleepCandidate[];
  /** Returns the renderer memory given back (KB), null if unknown. */
  sleepTab(id: number): number | null | void;
  getSleepAfterMinutes(): number;
  freezeTab?(id: number): Promise<boolean>;
  getFreezeAfterMinutes?(): number;
  getMemorySaver?(): { mode: MemorySaverMode; thresholdGB: number };
  tabIdForWebContents?(wcId: number): number | null;
}

export interface MemorySaverNotice {
  freedMB: number;
  at: number;
}

const TICK_MS = 30_000;
const LOW_MEMORY_RATIO = 0.1;
/** Under memory pressure, never sleep a tab the user left less than a minute ago. */
const PRESSURE_MIN_IDLE_MS = 60_000;
/** Cap per tick so a pressure spike doesn't wipe every background tab at once. */
const PRESSURE_MAX_PER_TICK = 2;

let timer: NodeJS.Timeout | null = null;
let currentDeps: SleeperDeps | null = null;
let lastSaverNotice: MemorySaverNotice | null = null;
/** Tab id -> downloads it started that are still in progress. */
const activeDownloads = new Map<number, number>();
const watchedSessions = new WeakSet<Session>();

function isEligible(tab: SleepCandidate): boolean {
  return !tab.active && !tab.asleep && !tab.audible && !tab.pinned && !tab.capturing && !activeDownloads.has(tab.id);
}

/** Never freeze or sleep a tab whose download is still running (its progress UI lives in the page). */
export function trackDownloadsForSleep(session: Session): void {
  if (watchedSessions.has(session)) return;
  watchedSessions.add(session);
  session.on('will-download', (_event, item, wc: WebContents | undefined) => {
    const tabId = wc && !wc.isDestroyed() ? (currentDeps?.tabIdForWebContents?.(wc.id) ?? null) : null;
    if (tabId === null) return;
    activeDownloads.set(tabId, (activeDownloads.get(tabId) ?? 0) + 1);
    item.once('done', () => {
      const left = (activeDownloads.get(tabId) ?? 1) - 1;
      if (left > 0) activeDownloads.set(tabId, left);
      else activeDownloads.delete(tabId);
    });
  });
}

/** Last time the memory saver slept tabs, for the perf chip; null until it acts. */
export function getMemorySaverNotice(): MemorySaverNotice | null {
  return lastSaverNotice;
}

function runFreeze(deps: SleeperDeps, tabs: SleepCandidate[], now: number, timeoutMs: number): void {
  const minutes = deps.getFreezeAfterMinutes?.() ?? 0;
  if (!deps.freezeTab || !(minutes > 0)) return;
  const freezeMs = minutes * 60_000;
  if (timeoutMs > 0 && freezeMs >= timeoutMs) return;
  const targets = pickFreezeTargets(
    tabs.filter((tab) => !tab.capturing).map((tab) => ({ ...tab, downloading: activeDownloads.has(tab.id) })),
    now,
    freezeMs,
  );
  for (const id of targets) void deps.freezeTab(id).catch(() => false);
}

function runMemorySaver(deps: SleeperDeps, tabs: SleepCandidate[], now: number, slept: Set<number>): void {
  const configured = deps.getMemorySaver?.();
  if (!configured || configured.mode === 'off') return;
  const saver = { ...configured, mode: effectiveMemorySaver(configured.mode, isBatterySaverActive()) };
  const metrics = app.getAppMetrics();
  const pidKB = new Map<number, number>();
  let usedKB = 0;
  for (const metric of metrics) {
    const kb = committedMemoryKB(metric);
    usedKB += kb;
    pidKB.set(metric.pid, kb);
  }
  const thresholdKB = saver.thresholdGB * 1024 * 1024;
  if (usedKB <= thresholdKB) return;
  const awake = tabs.filter((tab) => !tab.asleep && !slept.has(tab.id));
  const estimate = estimateTabMemoryKB(new Map(awake.map((tab) => [tab.id, tab.pids])), pidKB);
  const targets = pickSaverTargets(
    awake
      .filter((tab) => !tab.capturing)
      .map((tab) => ({ ...tab, downloading: activeDownloads.has(tab.id), memoryKB: estimate.get(tab.id) ?? 0 })),
    now,
    saver.mode,
    usedKB,
    thresholdKB,
  );
  if (targets.length === 0) return;
  let freedKB = 0;
  for (const id of targets) {
    const freed = deps.sleepTab(id);
    freedKB += typeof freed === 'number' ? freed : (estimate.get(id) ?? 0);
  }
  lastSaverNotice = { freedMB: Math.round(freedKB / 1024), at: now };
}

function underMemoryPressure(): boolean {
  const total = os.totalmem();
  return total > 0 && os.freemem() / total < LOW_MEMORY_RATIO;
}

function tick(deps: SleeperDeps): void {
  const minutes = deps.getSleepAfterMinutes();
  // Battery saver halves the timeouts: every awake renderer costs timers, GC and wakeups.
  const factor = batteryDelayDivisor(isBatterySaverActive());
  const timeoutMs = minutes > 0 ? (minutes * 60_000) / factor : 0;
  const now = Date.now();
  const all = deps.listTabs().map((tab) => (activeDownloads.has(tab.id) ? { ...tab, downloading: true } : { ...tab, downloading: false }));
  const candidates = all.filter(isEligible);
  const slept = new Set<number>();

  if (timeoutMs > 0) {
    for (const tab of candidates) {
      if (now - tab.lastActiveAt > timeoutMs) {
        deps.sleepTab(tab.id);
        slept.add(tab.id);
      }
    }
  }

  runFreeze(
    { ...deps, getFreezeAfterMinutes: () => (deps.getFreezeAfterMinutes?.() ?? 0) / factor },
    all.filter((tab) => !slept.has(tab.id)),
    now,
    timeoutMs,
  );
  runMemorySaver(deps, all, now, slept);

  if (timeoutMs <= 0 || !underMemoryPressure()) return; // 0 = user opted out of sleeping entirely
  const oldestFirst = candidates
    .filter((tab) => !slept.has(tab.id) && now - tab.lastActiveAt > PRESSURE_MIN_IDLE_MS)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    .slice(0, PRESSURE_MAX_PER_TICK);
  for (const tab of oldestFirst) deps.sleepTab(tab.id);
}

export function initSleeper(deps: SleeperDeps): void {
  stopSleeper();
  currentDeps = deps;
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
}
