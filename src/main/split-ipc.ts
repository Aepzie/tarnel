import { IPC } from '../shared/ipc';
import { SPLIT_MAX_PANES } from '../shared/split-layout';
import { addToSplit, closeSplit, createSplit, getSplit, isOnScreen, resizeSplit, separateTab, swapSplit, toggleSplit } from './split';
import { setPeek, setSplitRatios } from './window';

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Invalid id');
  return value;
}

function ratio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Invalid ratio');
  return value;
}

function splitId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || !getSplit(value)) throw new Error('Unknown split');
  return value;
}

function memberIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > SPLIT_MAX_PANES) throw new TypeError('Invalid tab ids');
  return value.map(int);
}

/** Split view handlers; `handle` is ipc.ts's chrome-only (sender-checked) registrar. */
export function registerSplitIpc(handle: ChromeHandler): void {
  const c = IPC.chrome;
  handle(c.splitCreate, (ids, focus) => createSplit(memberIds(ids), focus === null || focus === undefined ? undefined : int(focus)));
  handle(c.splitAdd, (id, tab, index) => addToSplit(splitId(id), int(tab), int(index)));
  handle(c.splitSeparate, (tab) => separateTab(int(tab)));
  handle(c.splitClose, (id) => closeSplit(splitId(id)));
  handle(c.splitResize, (id, x, y, commit) => {
    const target = splitId(id);
    const applied = resizeSplit(target, ratio(x), ratio(y), commit === true);
    const firstPane = getSplit(target)?.tabIds[0];
    if (applied && firstPane !== undefined && isOnScreen(firstPane)) setSplitRatios(applied.x, applied.y);
  });
  handle(c.splitSwap, (id) => swapSplit(splitId(id)));
  handle(c.splitToggle, () => toggleSplit());
  handle(c.splitPeek, (open) => setPeek(open === true));
}
