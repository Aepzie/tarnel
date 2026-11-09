import { randomUUID } from 'node:crypto';
import { SPLIT_DEFAULT_RATIO, SPLIT_MAX_PANES, sanitizeRatio } from '../shared/split-layout';
import type { SpaceId, SplitId, TabGroupId, TabSplit } from '../shared/types';

/**
 * Split view: 2–4 tabs of one Space shown side by side. A split is a per-Space relationship between
 * tabs, persisted with the session. Invariants (kept by tabs.ts through `clusterSplits` and
 * `SplitTabModel.adopt`): members are unpinned, share one tab group, and are adjacent in the tab
 * order, in pane order. The split holding the active tab is the one on screen; the active tab is its
 * focused pane. Splits with fewer than two members dissolve.
 */

/** Persisted with each split member in the session file (pane order = tab order). */
export interface SavedSplit {
  id: SplitId;
  ratioX: number;
  ratioY: number;
}

export interface SplitTabView {
  spaceId: SpaceId;
  pinned: boolean;
  groupId: TabGroupId | null;
  lastActiveAt: number;
}

/** The slice of tabs.ts this module needs. Bound once by tabs.ts (no import cycle). */
export interface SplitTabModel {
  order(): readonly number[];
  tab(id: number): SplitTabView | undefined;
  activeTabId(): number | null;
  /** Make the tab a valid member: unpin it and move it into `groupId`. */
  adopt(id: number, groupId: TabGroupId | null): void;
  /** Replace the tab order; tabs.ts re-normalizes (pinned, groups, splits) and emits. */
  commitOrder(ids: number[]): void;
  activate(id: number): void;
  /** Re-place the visible page views after the on-screen split changed. */
  refresh(): void;
  /** New awake background tab right after `afterId`. */
  create(opts: { spaceId: SpaceId; afterId: number }): number;
  emit(): void;
}

interface Split {
  id: SplitId;
  spaceId: SpaceId;
  tabIds: number[];
  ratioX: number;
  ratioY: number;
}

const splits = new Map<SplitId, Split>();
const byTab = new Map<number, SplitId>();
let model: SplitTabModel | null = null;

export function bindSplitModel(next: SplitTabModel): void {
  model = next;
}

function tabs(): SplitTabModel {
  if (!model) throw new Error('Tab model not bound');
  return model;
}

export function splitOf(tabId: number | null): Readonly<Split> | undefined {
  if (tabId === null) return undefined;
  const id = byTab.get(tabId);
  return id ? splits.get(id) : undefined;
}

export function splitIdOf(tabId: number): SplitId | null {
  return byTab.get(tabId) ?? null;
}

export function getSplit(id: SplitId): Readonly<Split> | undefined {
  return splits.get(id);
}

/** Members of the split holding `tabId` (in pane order), or just the tab. */
export function unitOf(tabId: number): number[] {
  return splitOf(tabId)?.tabIds.slice() ?? [tabId];
}

/** The tab is a pane of the split currently on screen. */
export function isOnScreen(tabId: number): boolean {
  const active = model?.activeTabId() ?? null;
  if (active === null) return false;
  if (active === tabId) return true;
  const split = splitOf(active);
  return !!split && split.tabIds.includes(tabId);
}

/** Pull every split's members together at the position of its first member, in pane order. */
export function clusterSplits(ids: readonly number[]): number[] {
  if (splits.size === 0) return [...ids];
  const out: number[] = [];
  const placed = new Set<SplitId>();
  const present = new Set(ids);
  for (const id of ids) {
    const splitId = byTab.get(id);
    if (!splitId) out.push(id);
    else if (!placed.has(splitId)) {
      placed.add(splitId);
      out.push(...splits.get(splitId)!.tabIds.filter((member) => present.has(member)));
    }
  }
  return out;
}

/** Splits in display order (by their first member), as fresh objects for BrowserState. */
export function splitsInOrder(ids: readonly number[]): TabSplit[] {
  const out: TabSplit[] = [];
  const seen = new Set<SplitId>();
  for (const id of ids) {
    const splitId = byTab.get(id);
    if (!splitId || seen.has(splitId)) continue;
    seen.add(splitId);
    const split = splits.get(splitId)!;
    out.push({ id: split.id, spaceId: split.spaceId, tabIds: [...split.tabIds], ratioX: split.ratioX, ratioY: split.ratioY });
  }
  return out;
}

function dissolve(split: Split): void {
  splits.delete(split.id);
  for (const id of split.tabIds) if (byTab.get(id) === split.id) byTab.delete(id);
}

/** Drop a tab from its split without touching order or views (tab closing / changing space / pinning). */
export function detachFromSplit(tabId: number): Readonly<Split> | undefined {
  const split = splitOf(tabId);
  if (!split) return undefined;
  const entry = splits.get(split.id)!;
  entry.tabIds = entry.tabIds.filter((id) => id !== tabId);
  byTab.delete(tabId);
  if (entry.tabIds.length < 2) dissolve(entry);
  return entry;
}

/** Make `members` (pane order) adjacent, starting where the earliest of them sits, and unify their group. */
function place(members: number[], ...extra: number[]): void {
  const model = tabs();
  const order = model.order();
  const set = new Set([...members, ...extra]);
  const anchor = order.findIndex((id) => set.has(id));
  const groupId = model.tab(order[anchor] ?? members[0]!)?.groupId ?? null;
  for (const id of members) model.adopt(id, groupId);
  const rest = order.filter((id) => !set.has(id));
  const before = order.slice(0, Math.max(0, anchor)).filter((id) => !set.has(id)).length;
  rest.splice(before, 0, ...members);
  model.commitOrder(rest);
}

/** Valid, de-duplicated members of one space (the first tab's), capped at SPLIT_MAX_PANES. */
function validMembers(tabIds: readonly number[]): number[] {
  const model = tabs();
  const first = model.tab(tabIds[0] ?? -1);
  if (!first) return [];
  return [...new Set(tabIds)].filter((id) => model.tab(id)?.spaceId === first.spaceId).slice(0, SPLIT_MAX_PANES);
}

/**
 * Show `tabIds` (pane order) side by side. Members leave any split they were in. The focused pane is
 * `focus`, else the active tab when it is a member, else the first one.
 */
export function createSplit(tabIds: readonly number[], focus?: number): SplitId | null {
  const model = tabs();
  const members = validMembers(tabIds);
  if (members.length < 2) return null;
  for (const id of members) detachFromSplit(id);
  const split: Split = { id: randomUUID(), spaceId: model.tab(members[0]!)!.spaceId, tabIds: members, ratioX: SPLIT_DEFAULT_RATIO, ratioY: SPLIT_DEFAULT_RATIO };
  splits.set(split.id, split);
  for (const id of members) byTab.set(id, split.id);
  place(members);
  const active = model.activeTabId();
  const target = focus !== undefined && members.includes(focus) ? focus : active !== null && members.includes(active) ? active : members[0]!;
  model.activate(target);
  return split.id;
}

/** Add a tab as a new pane at `index` (end when out of range). Ignored once the split is full. */
export function addToSplit(splitId: SplitId, tabId: number, index: number): void {
  const model = tabs();
  const split = splits.get(splitId);
  const tab = model.tab(tabId);
  if (!split || !tab || tab.spaceId !== split.spaceId || split.tabIds.includes(tabId) || split.tabIds.length >= SPLIT_MAX_PANES) return;
  detachFromSplit(tabId);
  const at = Math.max(0, Math.min(split.tabIds.length, index));
  split.tabIds.splice(at, 0, tabId);
  byTab.set(tabId, split.id);
  place(split.tabIds);
  model.activate(tabId);
}

/** Take one tab out of its split (the split dissolves when one tab is left); it lands right after the rest. */
export function separateTab(tabId: number): void {
  const model = tabs();
  const split = detachFromSplit(tabId);
  if (!split) return;
  const remaining = split.tabIds;
  const order = model.order().filter((id) => id !== tabId);
  const last = remaining.reduce((at, id) => Math.max(at, order.indexOf(id)), -1);
  order.splice(last === -1 ? order.length : last + 1, 0, tabId);
  model.commitOrder(order);
  model.refresh();
}

/** Dissolve a split; its tabs stay where they are and the focused pane stays active, alone. */
export function closeSplit(splitId: SplitId): void {
  const split = splits.get(splitId);
  if (!split) return;
  dissolve(split);
  tabs().refresh();
  tabs().emit();
}

/** Divider drag. Live updates only re-place views; `commit` persists and pushes state. */
export function resizeSplit(splitId: SplitId, ratioX: number, ratioY: number, commit: boolean): { x: number; y: number } | null {
  const split = splits.get(splitId);
  if (!split) return null;
  split.ratioX = sanitizeRatio(ratioX);
  split.ratioY = sanitizeRatio(ratioY);
  if (commit) tabs().emit();
  return { x: split.ratioX, y: split.ratioY };
}

/** Rotate the panes one step (2 panes: swap sides). */
export function swapSplit(splitId: SplitId): void {
  const split = splits.get(splitId);
  if (!split) return;
  const last = split.tabIds.pop();
  if (last !== undefined) split.tabIds.unshift(last);
  place(split.tabIds);
  tabs().refresh();
}

/**
 * Palette / shortcut: close the split on screen, or split the active tab with the most recently
 * used other tab of its space (a new tab when there is none). Returns the new tab id, if any.
 */
export function toggleSplit(): number | null {
  const model = tabs();
  const active = model.activeTabId();
  if (active === null) return null;
  const current = splitOf(active);
  if (current) {
    closeSplit(current.id);
    return null;
  }
  const self = model.tab(active);
  if (!self) return null;
  let partner: number | null = null;
  let best = -Infinity;
  for (const id of model.order()) {
    const tab = model.tab(id);
    if (id === active || !tab || tab.spaceId !== self.spaceId || tab.lastActiveAt <= best) continue;
    partner = id;
    best = tab.lastActiveAt;
  }
  if (partner !== null) {
    createSplit([active, partner], active);
    return null;
  }
  const created = model.create({ spaceId: self.spaceId, afterId: active });
  createSplit([active, created], created);
  return created;
}

export function savedSplit(tabId: number): SavedSplit | undefined {
  const split = splitOf(tabId);
  return split && { id: split.id, ratioX: split.ratioX, ratioY: split.ratioY };
}

/** Rebuild splits from restored tabs (`entries` in session order). Invalid or single-tab splits are dropped. */
export function restoreSplits(entries: readonly { tabId: number; saved: unknown }[]): void {
  const found = new Map<string, { tabIds: number[]; ratioX: number; ratioY: number }>();
  for (const { tabId, saved } of entries) {
    if (!saved || typeof saved !== 'object') continue;
    const raw = saved as Partial<SavedSplit>;
    if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) continue;
    const entry = found.get(raw.id);
    if (entry) entry.tabIds.push(tabId);
    else found.set(raw.id, { tabIds: [tabId], ratioX: sanitizeRatio(raw.ratioX), ratioY: sanitizeRatio(raw.ratioY) });
  }
  const model = tabs();
  for (const [id, entry] of found) {
    const members = validMembers(entry.tabIds).filter((tabId) => !byTab.has(tabId) && !model.tab(tabId)?.pinned);
    if (members.length < 2 || splits.has(id)) continue;
    splits.set(id, { id, spaceId: model.tab(members[0]!)!.spaceId, tabIds: members, ratioX: entry.ratioX, ratioY: entry.ratioY });
    for (const tabId of members) byTab.set(tabId, id);
    place(members);
  }
}
