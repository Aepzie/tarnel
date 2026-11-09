import { app, type ProcessMetric } from 'electron';
import type { PerfStats } from '../../shared/types';

/** Used for "memory saved" when no web-page renderer has been measured yet; typical light page. */
const FALLBACK_RENDERER_KB = 80 * 1024;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Memory a process really costs, in KB. On Windows `privateBytes` (private commit) is what Task
 * Manager reports per process; `workingSetSize` also counts shared pages (Chromium/system DLLs,
 * shared memory) once *per process*, so summing it over ~10 processes double-counts hundreds of MB.
 * macOS has no privateBytes in getAppMetrics: fall back to the working set there.
 */
export function processMemoryKB(metric: ProcessMetric): number {
  return metric.memory.privateBytes ?? metric.memory.workingSetSize;
}

/** Summed private memory of the renderer processes `pids`; null if none of them is known. */
export function rendererMemoryKB(pids: number[]): number | null {
  const wanted = new Set(pids.filter((pid) => pid > 0));
  const found = app.getAppMetrics().filter((m) => m.type === 'Tab' && wanted.has(m.pid));
  if (found.length === 0) return wanted.size === 0 ? 0 : null;
  return found.reduce((sum, metric) => sum + processMemoryKB(metric), 0);
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

export function collectPerfStats(input: PerfInput): PerfStats {
  let totalKB = 0;
  let cpu = 0;
  let pageKB = 0;
  let pageProcs = 0;
  const uiPids = new Set(input.uiRendererPids);

  for (const metric of app.getAppMetrics()) {
    const kb = processMemoryKB(metric);
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
