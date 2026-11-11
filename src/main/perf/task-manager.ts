import { webContents, type WebContents } from 'electron';
import {
  buildTaskSnapshot,
  TASK_MANAGER_IPC,
  type ExtensionSample,
  type ProcessSample,
  type TabSample,
  type TaskSnapshot,
  type TaskTabState,
} from '../../shared/task-manager';
import type { TabState } from '../../shared/types';
import { listExtensions } from '../extensions';
import { listSpaces } from '../spaces';
import { getBrowserState, getTabWebContents } from '../tabs';
import { getChromeView } from '../window';
import { measureAppProcesses } from './metrics';

/**
 * Task manager data (Shift+Esc). Everything is computed on demand: the chrome asks for a snapshot
 * once a second while the panel is open, so a closed panel costs nothing.
 */

function framePids(wc: WebContents): number[] {
  const pids = [wc.getOSProcessId()];
  try {
    for (const frame of wc.mainFrame.framesInSubtree) pids.push(frame.osProcessId);
  } catch {
    /* frame tree unavailable while the renderer is going away */
  }
  return pids.filter((pid) => pid > 0);
}

function tabState(tab: TabState, activeTabId: number | null, wc: WebContents | null): TaskTabState {
  if (tab.asleep || !wc) return 'asleep';
  if (wc.isCrashed()) return 'crashed';
  if (tab.id === activeTabId) return 'active';
  return tab.audible ? 'audible' : 'background';
}

function extensionSamples(): ExtensionSample[] {
  const installed = listExtensions().filter((extension) => extension.enabled);
  if (installed.length === 0) return [];
  const pages = new Map<string, number[]>();
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(wc.getURL());
    if (!match || wc.getType() !== 'backgroundPage') continue;
    pages.set(match[1], [...(pages.get(match[1]) ?? []), ...framePids(wc)]);
  }
  const workers = new Map<string, Set<number>>();
  const sessions = new Set(webContents.getAllWebContents().filter((wc) => !wc.isDestroyed()).map((wc) => wc.session));
  for (const session of sessions) {
    for (const worker of Object.values(session.serviceWorkers.getAllRunning())) {
      const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(worker.scope);
      if (!match) continue;
      const ids = workers.get(match[1]) ?? new Set<number>();
      ids.add(worker.renderProcessId);
      workers.set(match[1], ids);
    }
  }
  return installed.map((extension) => ({
    id: extension.id,
    name: extension.name,
    icon: extension.icon,
    pids: pages.get(extension.id) ?? [],
    workerProcessIds: [...(workers.get(extension.id) ?? [])],
  }));
}

export async function taskSnapshot(): Promise<TaskSnapshot> {
  const processes: ProcessSample[] = (await measureAppProcesses()).map(({ metric, memoryKB }) => ({
    pid: metric.pid,
    type: metric.type,
    name: metric.name,
    serviceName: metric.serviceName,
    cpuPercent: metric.cpu.percentCPUUsage,
    memoryKB,
    creationTime: metric.creationTime,
  }));
  const state = getBrowserState();
  const colors = new Map(listSpaces().map((space) => [space.id, space.color]));
  const tabs: TabSample[] = state.tabs.map((tab) => {
    const wc = tab.asleep ? null : getTabWebContents(tab.id);
    const live = wc && !wc.isDestroyed() ? wc : null;
    return {
      id: tab.id,
      title: tab.title || tab.url,
      favicon: tab.favicon,
      spaceColor: colors.get(tab.spaceId) ?? null,
      state: tabState(tab, state.activeTabId, live),
      pids: live ? framePids(live) : [],
    };
  });
  const chrome = getChromeView()?.webContents;
  return buildTaskSnapshot({
    processes,
    tabs,
    extensions: extensionSamples(),
    interfacePids: chrome && !chrome.isDestroyed() ? framePids(chrome) : [],
  });
}

/** Crash the tab's renderer; tabs.ts turns that into the crash page (or a clean reload later). */
export function endTabProcess(id: number): void {
  const wc = getTabWebContents(id);
  if (wc && !wc.isDestroyed() && !wc.isCrashed()) wc.forcefullyCrashRenderer();
}

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/** `handle` is ipc.ts's chrome-only (sender-checked) registrar. */
export function registerTaskManagerIpc(handle: ChromeHandler): void {
  handle(TASK_MANAGER_IPC.snapshot, () => taskSnapshot());
  handle(TASK_MANAGER_IPC.endProcess, (id) => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new TypeError('Invalid tab id');
    endTabProcess(id);
  });
}
