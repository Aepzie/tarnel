import { app, type ProcessMetric } from 'electron';
import type { PerfStats } from '../../shared/types';
import { cachedPrivateWorkingSetKB, samplePrivateWorkingSetKB, stopPrivateWorkingSetSampler } from './private-ws';

/** Used for "memory saved" when no web-page renderer has been measured yet; typical light page. */
const FALLBACK_RENDERER_KB = 80 * 1024;

const round1 = (n: number): number => Math.round(n * 10) / 10;

app.once('will-quit', stopPrivateWorkingSetSampler);

/**
 * Memory a process has committed, in KB: `privateBytes` (private commit) on Windows, the working set
 * on macOS/Linux where getAppMetrics has nothing better. Never double-counts shared pages (summing
 * `workingSetSize` over ~10 processes over-reports by hundreds of MB), and unlike the working set it
 * does not drop when Windows trims pages under memory pressure — so the memory saver keeps using it.
 * It is *not* what Task Manager shows (see `displayMemoryKB`).
 */
export function committedMemoryKB(metric: ProcessMetric): number {
  return metric.memory.privateBytes ?? metric.memory.workingSetSize;
}

/**
 * Memory shown to the user (perf chip, popover, task manager), in KB. Windows: private working set —
 * exactly Task Manager's "Memory" column — from `sampled` (see private-ws.ts), else the last fresh
 * sample, else private commit. macOS/Linux: the resident working set from getAppMetrics (Activity
 * Monitor's "Memory" is phys_footprint, which Electron only reports for its own process).
 */
export function displayMemoryKB(metric: ProcessMetric, sampled?: ReadonlyMap<number, number> | null): number {
  return sampled?.get(metric.pid) ?? cachedPrivateWorkingSetKB(metric.pid) ?? committedMemoryKB(metric);
}

export interface MeasuredProcess {
  metric: ProcessMetric;
  memoryKB: number;
}

/** Every Tarnel process with its displayed memory, sampled together so totals are consistent. */
export async function measureAppProcesses(): Promise<MeasuredProcess[]> {
  const metrics = app.getAppMetrics();
  const sampled = await samplePrivateWorkingSetKB(metrics.map((metric) => metric.pid));
  return metrics.map((metric) => ({ metric, memoryKB: displayMemoryKB(metric, sampled) }));
}

/** Summed displayed memory of the renderer processes `pids`; null if none of them is known. */
export function rendererMemoryKB(pids: number[]): number | null {
  const wanted = new Set(pids.filter((pid) => pid > 0));
  const found = app.getAppMetrics().filter((m) => m.type === 'Tab' && wanted.has(m.pid));
  if (found.length === 0) return wanted.size === 0 ? 0 : null;
  return found.reduce((sum, metric) => sum + displayMemoryKB(metric), 0);
}

export interface PerfInput {
  tabsAwake: number;
  tabsAsleep: number;
  blockedTotal: number;
  /** Renderer memory measured right before each tab that is asleep now was put to sleep (KB). */
  sleptRendererKB: number[];
  /** Renderer pids that are not web pages (the browser UI); excluded from the per-page average. */
  uiRendererPids: number[];
}

export async function collectPerfStats(input: PerfInput): Promise<PerfStats> {
  let totalKB = 0;
  let cpu = 0;
  let pageKB = 0;
  let pageProcs = 0;
  const uiPids = new Set(input.uiRendererPids);

  for (const { metric, memoryKB: kb } of await measureAppProcesses()) {
    totalKB += kb;
    cpu += metric.cpu.percentCPUUsage;
    if (metric.type === 'Tab' && !uiPids.has(metric.pid)) {
      pageKB += kb;
      pageProcs += 1;
    }
  }

  // Tabs restored asleep were never measured this run: estimate them from the awake pages (which
  // include the new-tab page and the spare renderer, so this under-claims rather than over-claims).
  const unmeasured = Math.max(0, input.tabsAsleep - input.sleptRendererKB.length);
  const avgPageKB = pageProcs > 0 ? pageKB / pageProcs : FALLBACK_RENDERER_KB;
  const measuredKB = input.sleptRendererKB.reduce((sum, kb) => sum + kb, 0);

  return {
    totalMemoryMB: Math.round(totalKB / 1024),
    cpuPercent: round1(cpu),
    tabsAwake: input.tabsAwake,
    tabsAsleep: input.tabsAsleep,
    blockedTotal: input.blockedTotal,
    savedMemoryMB: Math.round((measuredKB + unmeasured * avgPageKB) / 1024),
  };
}
