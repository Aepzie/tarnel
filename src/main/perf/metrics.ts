import { app } from 'electron';
import type { PerfStats } from '../../shared/types';

/** Used for "memory saved" before any tab renderer exists to measure; typical light page footprint. */
const FALLBACK_RENDERER_MB = 80;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function collectPerfStats(input: { tabsAwake: number; tabsAsleep: number; blockedTotal: number }): PerfStats {
  let totalKB = 0;
  let cpu = 0;
  let tabKB = 0;
  let tabProcs = 0;

  // workingSetSize is reported in KB. Summed over browser, GPU, utility and every renderer process,
  // this is the same "all processes" figure Task Manager shows, so comparisons with Chrome are fair.
  for (const metric of app.getAppMetrics()) {
    totalKB += metric.memory.workingSetSize;
    cpu += metric.cpu.percentCPUUsage;
    if (metric.type === 'Tab') {
      tabKB += metric.memory.workingSetSize;
      tabProcs += 1;
    }
  }

  // The chrome UI is itself a 'Tab' renderer; it is included in the average, which slightly
  // understates savings — we prefer to under-claim.
  const avgRendererMB = tabProcs > 0 ? tabKB / 1024 / tabProcs : FALLBACK_RENDERER_MB;

  return {
    totalMemoryMB: Math.round(totalKB / 1024),
    cpuPercent: round1(cpu),
    tabsAwake: input.tabsAwake,
    tabsAsleep: input.tabsAsleep,
    blockedTotal: input.blockedTotal,
    savedMemoryMB: Math.round(input.tabsAsleep * avgRendererMB),
  };
}
