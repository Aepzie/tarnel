import type { SplitId, TabGroup, TabGroupId, TabSplit, TabState } from '@shared/types';

/**
 * A tab list is rendered as a flat sequence of "units" so one motion `Reorder.Group` can reorder
 * tabs, splits and groups alike: a group header (key `g:<id>`) followed by its visible members — tabs
 * (key = tab id) and split views (key `s:<id>`, the joined panes as one unit). Collapsed groups
 * contribute only their header, plus the unit holding the active tab.
 */
export type GroupKey = `g:${string}`;
export type SplitKey = `s:${string}`;
export type UnitKey = number | GroupKey | SplitKey;

export interface TabUnit {
  kind: 'tab';
  key: number;
  tab: TabState;
  group: TabGroup | null;
  /** Last visible member of its group (rails / underlines end here). */
  lastInGroup: boolean;
}

export interface SplitUnit {
  kind: 'split';
  key: SplitKey;
  split: TabSplit;
  /** Member tabs in pane order. */
  tabs: TabState[];
  group: TabGroup | null;
  lastInGroup: boolean;
}

export interface GroupUnit {
  kind: 'group';
  key: GroupKey;
  group: TabGroup;
  /** Number of tabs in the group (visible or not). */
  count: number;
}

export type Unit = TabUnit | SplitUnit | GroupUnit;

export const groupKey = (id: TabGroupId): GroupKey => `g:${id}`;
export const splitKey = (id: SplitId): SplitKey => `s:${id}`;
export const isGroupKey = (key: UnitKey): key is GroupKey => typeof key === 'string' && key.startsWith('g:');
export const isSplitKey = (key: UnitKey): key is SplitKey => typeof key === 'string' && key.startsWith('s:');
const groupIdOf = (key: GroupKey): TabGroupId => key.slice(2);
const splitIdOf = (key: SplitKey): SplitId => key.slice(2);

/** Tabs of the unit (one tab, or a split's panes). */
export function unitTabs(unit: Unit): TabState[] {
  if (unit.kind === 'tab') return [unit.tab];
  if (unit.kind === 'split') return unit.tabs;
  return [];
}

/**
 * @param tabs unpinned tabs of one space, in main's order (group members contiguous, split panes adjacent)
 * @param folded a group being dragged by its header: shown without members, like a collapsed one
 */
export function buildUnits(
  tabs: TabState[],
  groups: TabGroup[],
  splits: TabSplit[],
  activeTabId: number | null,
  folded: TabGroupId | null = null,
): Unit[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const splitById = new Map(splits.map((split) => [split.id, split]));
  const counts = new Map<TabGroupId, number>();
  for (const tab of tabs) if (tab.groupId) counts.set(tab.groupId, (counts.get(tab.groupId) ?? 0) + 1);

  const units: Unit[] = [];
  let current: TabGroupId | null = null;
  let openSplit: SplitUnit | null = null;
  for (const tab of tabs) {
    const group = tab.groupId ? (byId.get(tab.groupId) ?? null) : null;
    if (group && group.id !== current) {
      units.push({ kind: 'group', key: groupKey(group.id), group, count: counts.get(group.id) ?? 0 });
    }
    current = group?.id ?? null;
    const split = tab.splitId ? splitById.get(tab.splitId) : undefined;
    if (split && openSplit?.split.id === split.id) {
      openSplit.tabs.push(tab);
      continue;
    }
    openSplit = null;
    const holdsActive = split ? split.tabIds.includes(activeTabId ?? -1) : tab.id === activeTabId;
    const hidden = group && (group.id === folded || (group.collapsed && !holdsActive));
    if (hidden) continue;
    if (split) {
      openSplit = { kind: 'split', key: splitKey(split.id), split, tabs: [tab], group, lastInGroup: false };
      units.push(openSplit);
    } else {
      units.push({ kind: 'tab', key: tab.id, tab, group, lastInGroup: false });
    }
  }
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    if (unit.kind === 'group' || !unit.group) continue;
    const next = units[i + 1];
    unit.lastInGroup = !(next && next.kind !== 'group' && next.group?.id === unit.group.id);
  }
  return units;
}

/** Visible units re-sequenced by a local drag order; units unknown to the drag order keep their place at the end. */
export function orderUnits(units: Unit[], keys: UnitKey[] | null): Unit[] {
  if (!keys) return units;
  const byKey = new Map<UnitKey, Unit>(units.map((unit) => [unit.key, unit]));
  const out: Unit[] = [];
  for (const key of keys) {
    const unit = byKey.get(key);
    if (!unit) continue;
    out.push(unit);
    byKey.delete(key);
  }
  return [...out, ...byKey.values()];
}

export type Drop =
  | { kind: 'tab'; tabId: number; before: number | null; groupId: TabGroupId | null }
  | { kind: 'group'; groupId: TabGroupId; before: number | null };

/**
 * Translate a finished drag (the dragged unit's place in `keys`) into a main-process move. A split
 * moves as one tab (main moves its partners along).
 *
 * Membership of a dropped tab: right after a group header, or between two members → that group.
 * At the end of a group a member stays inside, unless it already was the last one (dragging the
 * last tab past the edge takes it out). Anywhere else → ungrouped.
 */
export function resolveDrop(keys: UnitKey[], dragged: UnitKey, tabs: TabState[]): Drop | null {
  const index = keys.indexOf(dragged);
  if (index === -1) return null;
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const firstMember = (group: TabGroupId): number | null => tabs.find((tab) => tab.groupId === group)?.id ?? null;
  const leadOf = (key: UnitKey | undefined): TabState | undefined => {
    if (key === undefined || isGroupKey(key)) return undefined;
    if (isSplitKey(key)) return tabs.find((tab) => tab.splitId === splitIdOf(key));
    return byId.get(key);
  };
  const anchorOf = (key: UnitKey | undefined): number | null => {
    if (key === undefined) return null;
    return isGroupKey(key) ? firstMember(groupIdOf(key)) : (leadOf(key)?.id ?? null);
  };

  if (isGroupKey(dragged)) {
    const own = groupIdOf(dragged);
    const next = keys.slice(index + 1).find((key) => (isGroupKey(key) ? key !== dragged : leadOf(key)?.groupId !== own));
    return { kind: 'group', groupId: own, before: anchorOf(next) };
  }

  const tab = leadOf(dragged);
  if (!tab) return null;
  const unit = isSplitKey(dragged) ? tabs.filter((candidate) => candidate.splitId === tab.splitId).map((candidate) => candidate.id) : [tab.id];
  const prev = keys[index - 1];
  const next = keys[index + 1];
  const groupOfKey = (key: UnitKey | undefined): TabGroupId | null => leadOf(key)?.groupId ?? null;

  let groupId: TabGroupId | null = null;
  if (prev !== undefined && isGroupKey(prev)) groupId = groupIdOf(prev);
  else {
    const prevGroup = groupOfKey(prev);
    if (prevGroup && groupOfKey(next) === prevGroup) groupId = prevGroup;
    else if (prevGroup && tab.groupId === prevGroup) {
      const members = tabs.filter((candidate) => candidate.groupId === prevGroup);
      const wasLast = unit.includes(members[members.length - 1]?.id ?? -1);
      groupId = wasLast ? null : prevGroup;
    }
  }
  return { kind: 'tab', tabId: tab.id, before: anchorOf(next), groupId };
}
