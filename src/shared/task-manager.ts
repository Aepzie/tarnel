import type { SpaceColor } from './types';

/**
 * Task manager (Shift+Esc): one row per tab, extension and browser service, built from
 * `app.getAppMetrics()` by pid. Pure: the main process gathers the inputs, this module maps
 * processes to rows (unit-tested in task-manager.test.ts).
 */

export const TASK_MANAGER_IPC = {
  /** One snapshot; the chrome polls it once a second only while the panel is open. */
  snapshot: 'chrome:task-manager-snapshot',
  /** Crash a tab's renderer (the tab shows its crash page / reloads when next activated). */
  endProcess: 'chrome:task-manager-end-process',
} as const;

export type TaskKind = 'tab' | 'extension' | 'browser' | 'gpu' | 'utility' | 'interface' | 'renderer';

export type TaskTabState = 'active' | 'audible' | 'background' | 'asleep' | 'crashed';

export interface TaskRow {
  /** Stable React key. */
  key: string;
  kind: TaskKind;
  title: string;
  /** Tab id for tab rows (Sleep / End process / Go to tab). */
  tabId: number | null;
  favicon: string | null;
  spaceColor: SpaceColor | null;
  state: TaskTabState | null;
  pids: number[];
  /** null = no live process (asleep tab, extension without a mapped process). */
  cpuPercent: number | null;
  memoryMB: number | null;
  /** At least one process is also counted on another row (same-site tabs share renderers). */
  shared: boolean;
}

export interface TaskSnapshot {
  rows: TaskRow[];
  /** Summed over processes, so shared renderers are counted once. */
  totals: { cpuPercent: number; memoryMB: number; processes: number };
}

/** Subset of Electron's ProcessMetric the aggregation needs (memory already resolved to KB). */
export interface ProcessSample {
  pid: number;
  type: string;
  /** Utility process name, e.g. "Network Service". */
  name?: string;
  serviceName?: string;
  cpuPercent: number;
  memoryKB: number;
  creationTime: number;
}

export interface TabSample {
  id: number;
  title: string;
  favicon: string | null;
  spaceColor: SpaceColor | null;
  state: TaskTabState;
  /** Renderer pids of the page and its out-of-process iframes; empty when asleep. */
  pids: number[];
}

export interface ExtensionSample {
  id: string;
  name: string;
  icon: string | null;
  /** OS pids of background pages / extension frames, when known. */
  pids: number[];
  /** Chromium render-process ids of running service workers (not OS pids). */
  workerProcessIds: number[];
}

export interface TaskInput {
  processes: ProcessSample[];
  tabs: TabSample[];
  extensions: ExtensionSample[];
  /** The browser chrome renderer(s). */
  interfacePids: number[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const toMB = (kb: number): number => round1(kb / 1024);

const UTILITY_TITLES: Record<string, string> = {
  'network.mojom.NetworkService': 'Network service',
  'audio.mojom.AudioService': 'Audio service',
  'storage.mojom.StorageService': 'Storage service',
  'video_capture.mojom.VideoCaptureService': 'Video capture service',
  'data_decoder.mojom.DataDecoderService': 'Data decoder service',
};

function utilityTitle(sample: ProcessSample): string {
  if (sample.serviceName && UTILITY_TITLES[sample.serviceName]) return UTILITY_TITLES[sample.serviceName];
  if (sample.name) return sample.name.charAt(0).toUpperCase() + sample.name.slice(1).toLowerCase();
  return 'Utility process';
}

/**
 * Chromium hands out render-process ids in creation order, so when the renderers no page owns are
 * exactly as many as the processes running extension service workers, both orders line up.
 * Otherwise (spare renderer, shared process) nothing is guessed.
 */
export function matchWorkerPids(unowned: ProcessSample[], workerProcessIds: number[]): Map<number, number> {
  const ids = [...new Set(workerProcessIds)].sort((a, b) => a - b);
  const byAge = [...unowned].sort((a, b) => a.creationTime - b.creationTime || a.pid - b.pid);
  const matched = new Map<number, number>();
  if (ids.length === 0 || ids.length !== byAge.length) return matched;
  ids.forEach((id, index) => matched.set(id, byAge[index].pid));
  return matched;
}

export function buildTaskSnapshot(input: TaskInput): TaskSnapshot {
  const byPid = new Map(input.processes.map((sample) => [sample.pid, sample]));
  const owners = new Map<number, number>();
  const own = (pids: number[]): number[] => {
    const live = [...new Set(pids)].filter((pid) => byPid.has(pid));
    for (const pid of live) owners.set(pid, (owners.get(pid) ?? 0) + 1);
    return live;
  };

  const interfacePids = own(input.interfacePids);
  const tabPids = input.tabs.map((tab) => (tab.state === 'asleep' ? [] : own(tab.pids)));
  const extensionPids = input.extensions.map((extension) => own(extension.pids));

  const unowned = input.processes.filter((sample) => sample.type === 'Tab' && !owners.has(sample.pid));
  const needWorker = input.extensions.filter((_, index) => extensionPids[index].length === 0);
  const workerPids = matchWorkerPids(unowned, needWorker.flatMap((extension) => extension.workerProcessIds));
  input.extensions.forEach((extension, index) => {
    if (extensionPids[index].length > 0) return;
    const mapped = extension.workerProcessIds.map((id) => workerPids.get(id)).filter((pid): pid is number => pid !== undefined);
    extensionPids[index] = own(mapped);
  });

  const measure = (pids: number[]): Pick<TaskRow, 'cpuPercent' | 'memoryMB' | 'shared' | 'pids'> => {
    if (pids.length === 0) return { pids, cpuPercent: null, memoryMB: null, shared: false };
    let cpu = 0;
    let kb = 0;
    for (const pid of pids) {
      const sample = byPid.get(pid);
      if (!sample) continue;
      cpu += sample.cpuPercent;
      kb += sample.memoryKB;
    }
    return { pids, cpuPercent: round1(cpu), memoryMB: toMB(kb), shared: pids.some((pid) => (owners.get(pid) ?? 0) > 1) };
  };

  const base = { tabId: null, favicon: null, spaceColor: null, state: null } as const;
  const rows: TaskRow[] = [];

  input.tabs.forEach((tab, index) => {
    rows.push({
      key: `tab:${tab.id}`,
      kind: 'tab',
      title: tab.title || 'Untitled',
      tabId: tab.id,
      favicon: tab.favicon,
      spaceColor: tab.spaceColor,
      state: tab.state,
      ...measure(tabPids[index]),
    });
  });
  input.extensions.forEach((extension, index) => {
    rows.push({ ...base, key: `ext:${extension.id}`, kind: 'extension', title: extension.name, favicon: extension.icon, ...measure(extensionPids[index]) });
  });

  for (const sample of input.processes) {
    if (owners.has(sample.pid)) continue;
    const kind = processKind(sample.type);
    const title =
      kind === 'browser' ? 'Browser' : kind === 'gpu' ? 'GPU process' : kind === 'renderer' ? 'Renderer (spare or extension)' : utilityTitle(sample);
    rows.push({ ...base, key: `pid:${sample.pid}`, kind, title, ...measure([sample.pid]) });
  }
  if (interfacePids.length > 0) rows.push({ ...base, key: 'interface', kind: 'interface', title: 'Vela interface', ...measure(interfacePids) });

  const totals = input.processes.reduce(
    (sum, sample) => ({ cpuPercent: sum.cpuPercent + sample.cpuPercent, memoryKB: sum.memoryKB + sample.memoryKB }),
    { cpuPercent: 0, memoryKB: 0 },
  );
  return {
    rows,
    totals: { cpuPercent: round1(totals.cpuPercent), memoryMB: toMB(totals.memoryKB), processes: input.processes.length },
  };
}

function processKind(type: string): TaskKind {
  switch (type) {
    case 'Browser':
      return 'browser';
    case 'GPU':
      return 'gpu';
    case 'Tab':
      return 'renderer';
    default:
      return 'utility';
  }
}

export type TaskSortKey = 'title' | 'cpu' | 'memory';

/** Sort for display: null values (asleep / unmapped) always last, ties by title. */
export function sortTaskRows(rows: TaskRow[], key: TaskSortKey, descending: boolean): TaskRow[] {
  const dir = descending ? -1 : 1;
  const value = (row: TaskRow): number | null => (key === 'cpu' ? row.cpuPercent : row.memoryMB);
  return [...rows].sort((a, b) => {
    if (key === 'title') return dir * a.title.localeCompare(b.title);
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return a.title.localeCompare(b.title);
    if (va === null) return 1;
    if (vb === null) return -1;
    return va === vb ? a.title.localeCompare(b.title) : dir * (va - vb);
  });
}
