import { useSyncExternalStore } from 'react';
import type { BrowserState, TabSplit } from '@shared/types';
import { SPLIT_MAX_PANES } from '@shared/split-layout';
import { getBrowserStateSnapshot, useBrowserSlice } from '@/hooks/browser';
import { acquireOverlay } from '@/hooks/overlay';
import { vela } from '@/lib/vela';

function sameSplit(a: TabSplit | undefined, b: TabSplit | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.ratioX === b.ratioX &&
    a.ratioY === b.ratioY &&
    a.tabIds.length === b.tabIds.length &&
    a.tabIds.every((id, i) => id === b.tabIds[i])
  );
}

function sameSplits(a: TabSplit[], b: TabSplit[]): boolean {
  return a.length === b.length && a.every((split, i) => sameSplit(split, b[i]));
}

export function activeSplitOf(state: BrowserState): TabSplit | undefined {
  const active = state.activeTabId;
  return active === null ? undefined : state.splits.find((split) => split.tabIds.includes(active));
}

/** The split on screen (holding the active tab). Stable while it is unchanged. */
export function useActiveSplit(): TabSplit | undefined {
  return useBrowserSlice(activeSplitOf, sameSplit);
}

/** Splits of the active space. Stable while none changed. */
export function useSpaceSplits(): TabSplit[] {
  return useBrowserSlice((s) => s.splits.filter((split) => split.spaceId === s.activeSpaceId), sameSplits);
}

/* ------------------------------------------------------------------------------------------------
 * Drag a tab onto the left / right edge of the page area to split with it. While a tab is dragged the
 * chrome is raised (overlay) so the drop zones can paint over the page and receive the pointer.
 * ---------------------------------------------------------------------------------------------- */

export type DropSide = 'left' | 'right';

export interface SplitDragState {
  tabId: number | null;
  side: DropSide | null;
}

let drag: SplitDragState = { tabId: null, side: null };
let release: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: SplitDragState): void {
  if (next.tabId === drag.tabId && next.side === drag.side) return;
  drag = next;
  listeners.forEach((cb) => cb());
}

export function useSplitDrag(): SplitDragState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => drag,
  );
}

/** Active tab before the current one: pressing a tab activates it, so a dragged tab usually is the active one. */
let previousActive: number | null = null;
let lastActive: number | null = null;

export function noteActiveTab(id: number | null): void {
  if (id === lastActive) return;
  previousActive = lastActive;
  lastActive = id;
}

/** The tab a dropped `tabId` splits with: the active tab, or the one shown before the drag activated it. */
function partnerFor(tabId: number, state: BrowserState): number | null {
  const candidate = state.activeTabId !== tabId ? state.activeTabId : previousActive;
  if (candidate === null || candidate === tabId) return null;
  const partner = state.tabs.find((tab) => tab.id === candidate);
  return partner && partner.spaceId === state.activeSpaceId ? partner.id : null;
}

function splitOf(tabId: number, state: BrowserState): TabSplit | undefined {
  return state.splits.find((split) => split.tabIds.includes(tabId));
}

/** Whether dropping `tabId` on the page area would split (or add a pane to its partner's split). */
export function canSplitWith(tabId: number, state: BrowserState = getBrowserStateSnapshot()): boolean {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  const partner = partnerFor(tabId, state);
  if (!tab || partner === null || tab.spaceId !== state.activeSpaceId) return false;
  const current = splitOf(partner, state);
  return !current || (!current.tabIds.includes(tabId) && current.tabIds.length < SPLIT_MAX_PANES);
}

export const splitDrag = {
  begin(tabId: number): void {
    if (!canSplitWith(tabId)) return;
    release?.();
    release = acquireOverlay();
    set({ tabId, side: null });
  },
  setSide(side: DropSide | null): void {
    if (drag.tabId !== null) set({ tabId: drag.tabId, side });
  },
  /** Ends the drag; returns the pending split drop, if the pointer was over a zone. */
  end(): { tabId: number; side: DropSide } | null {
    const result = drag.tabId !== null && drag.side ? { tabId: drag.tabId, side: drag.side } : null;
    set({ tabId: null, side: null });
    // Let the zone fade out above the page before handing the layer back.
    const pending = release;
    release = null;
    if (pending) window.setTimeout(pending, 160);
    return result;
  },
};

/** How many panes the page area will show once `tabId` is dropped (for the drop preview). */
export function panesAfterDrop(tabId: number, state: BrowserState = getBrowserStateSnapshot()): number {
  const partner = partnerFor(tabId, state);
  const current = partner === null ? undefined : splitOf(partner, state);
  return current ? current.tabIds.length + 1 : 2;
}

/** Split `tabId` (dropped on `side`) with its partner, or add it to the partner's split. */
export async function splitWithActive(tabId: number, side: DropSide): Promise<void> {
  const state = getBrowserStateSnapshot();
  const partner = partnerFor(tabId, state);
  if (partner === null || !canSplitWith(tabId, state)) return;
  const current = splitOf(partner, state);
  if (current) {
    await vela().split.add(current.id, tabId, side === 'left' ? 0 : current.tabIds.length);
    return;
  }
  await vela().split.create(side === 'left' ? [tabId, partner] : [partner, tabId], tabId);
}
