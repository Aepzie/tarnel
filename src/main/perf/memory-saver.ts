import type { MemorySaverMode } from '../../shared/types';

/**
 * Memory saver: when Vela as a whole (every process, private commit — deliberately not the private
 * working set the perf chip shows, which Windows shrinks by trimming exactly when memory gets tight,
 * and which would need the sampler running all the time) uses more than the user's
 * threshold, the least-recently-used eligible background tabs are slept until the estimate falls
 * back under it. Pure policy; the sleeper measures and acts.
 */

export interface SaverCandidate {
  id: number;
  lastActiveAt: number;
  audible: boolean;
  pinned: boolean;
  asleep: boolean;
  active: boolean;
  downloading: boolean;
  /** Estimated private memory this tab gives back when slept (KB). */
  memoryKB: number;
}

interface ModePolicy {
  /** A tab left more recently than this is never slept by the saver. */
  minIdleMs: number;
  /** Cap per 30 s tick, so one spike never wipes every background tab at once. */
  maxPerTick: number;
}

export const MEMORY_SAVER_POLICY: Record<Exclude<MemorySaverMode, 'off'>, ModePolicy> = {
  balanced: { minIdleMs: 5 * 60_000, maxPerTick: 2 },
  maximum: { minIdleMs: 30_000, maxPerTick: 6 },
};

export function isSaverEligible(tab: SaverCandidate): boolean {
  return !tab.active && !tab.asleep && !tab.audible && !tab.pinned && !tab.downloading;
}

/**
 * Tabs to sleep, least recently used first, until the estimated total drops under the threshold.
 * Returns [] when the saver is off or Vela is under the threshold.
 */
export function pickSaverTargets(
  tabs: readonly SaverCandidate[],
  now: number,
  mode: MemorySaverMode,
  usedKB: number,
  thresholdKB: number,
): number[] {
  if (mode === 'off' || !(thresholdKB > 0) || usedKB <= thresholdKB) return [];
  const policy = MEMORY_SAVER_POLICY[mode];
  const lru = tabs
    .filter((tab) => isSaverEligible(tab) && now - tab.lastActiveAt >= policy.minIdleMs)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  const picked: number[] = [];
  let remaining = usedKB;
  for (const tab of lru) {
    if (remaining <= thresholdKB || picked.length >= policy.maxPerTick) break;
    picked.push(tab.id);
    remaining -= Math.max(0, tab.memoryKB);
  }
  return picked;
}

/**
 * Splits each renderer's memory evenly among the awake tabs it hosts (Chromium may put same-site
 * tabs in one process; sleeping one of them frees only its share).
 */
export function estimateTabMemoryKB(tabPids: ReadonlyMap<number, readonly number[]>, pidKB: ReadonlyMap<number, number>): Map<number, number> {
  const sharers = new Map<number, number>();
  for (const pids of tabPids.values()) for (const pid of new Set(pids)) sharers.set(pid, (sharers.get(pid) ?? 0) + 1);
  const estimate = new Map<number, number>();
  for (const [tabId, pids] of tabPids) {
    let kb = 0;
    for (const pid of new Set(pids)) kb += (pidKB.get(pid) ?? 0) / (sharers.get(pid) ?? 1);
    estimate.set(tabId, Math.round(kb));
  }
  return estimate;
}
