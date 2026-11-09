import type { TabGroup, TabGroupId, TabState } from '@shared/types';

/**
 * A tab list is rendered as a flat sequence of "units" so one motion `Reorder.Group` can reorder
 * tabs and groups alike: a group header (key `g:<id>`) followed by its visible member tabs (key =
 * tab id). Collapsed groups contribute only their header, plus the active tab if it is a member.
 */
export type GroupKey = `g:${string}`;
export type UnitKey = number | GroupKey;

export interface TabUnit {
  kind: 'tab';
  key: number;
  tab: TabState;
  group: TabGroup | null;
  /** Last visible member of its group (rails / underlines end here). */
  lastInGroup: boolean;
}

export interface GroupUnit {
  kind: 'group';
  key: GroupKey;
  group: TabGroup;
  /** Number of tabs in the group (visible or not). */
  count: number;
}

export type Unit = TabUnit | GroupUnit;

export const groupKey = (id: TabGroupId): GroupKey => `g:${id}`;
export const isGroupKey = (key: UnitKey): key is GroupKey => typeof key === 'string';
const groupIdOf = (key: GroupKey): TabGroupId => key.slice(2);

/**
 * @param tabs unpinned tabs of one space, in main's order (group members contiguous)
 * @param folded a group being dragged by its header: shown without members, like a collapsed one
 */
export function buildUnits(tabs: TabState[], groups: TabGroup[], activeTabId: number | null, folded: TabGroupId | null = null): Unit[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const counts = new Map<TabGroupId, number>();
  for (const tab of tabs) if (tab.groupId) counts.set(tab.groupId, (counts.get(tab.groupId) ?? 0) + 1);

  const units: Unit[] = [];
  let current: TabGroupId | null = null;
  for (const tab of tabs) {
    const group = tab.groupId ? (byId.get(tab.groupId) ?? null) : null;
    if (group && group.id !== current) {
      units.push({ kind: 'group', key: groupKey(group.id), group, count: counts.get(group.id) ?? 0 });
    }
    current = group?.id ?? null;
    const hidden = group && (group.id === folded || (group.collapsed && tab.id !== activeTabId));
    if (hidden) continue;
    units.push({ kind: 'tab', key: tab.id, tab, group, lastInGroup: false });
  }
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    if (unit.kind !== 'tab' || !unit.group) continue;
    const next = units[i + 1];
    unit.lastInGroup = !(next?.kind === 'tab' && next.group?.id === unit.group.id);
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
 * Translate a finished drag (the dragged unit's place in `keys`) into a main-process move.
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
  const anchorOf = (key: UnitKey | undefined): number | null => {
    if (key === undefined) return null;
    return isGroupKey(key) ? firstMember(groupIdOf(key)) : key;
  };

  if (isGroupKey(dragged)) {
    const own = groupIdOf(dragged);
    const next = keys.slice(index + 1).find((key) => (isGroupKey(key) ? key !== dragged : byId.get(key)?.groupId !== own));
    return { kind: 'group', groupId: own, before: anchorOf(next) };
  }

  const tab = byId.get(dragged);
  if (!tab) return null;
  const prev = keys[index - 1];
  const next = keys[index + 1];
  const groupOfKey = (key: UnitKey | undefined): TabGroupId | null =>
    key === undefined ? null : isGroupKey(key) ? null : (byId.get(key)?.groupId ?? null);

  let groupId: TabGroupId | null = null;
  if (prev !== undefined && isGroupKey(prev)) groupId = groupIdOf(prev);
  else {
    const prevGroup = groupOfKey(prev);
    if (prevGroup && groupOfKey(next) === prevGroup) groupId = prevGroup;
    else if (prevGroup && tab.groupId === prevGroup) {
      const members = tabs.filter((candidate) => candidate.groupId === prevGroup);
      const wasLast = members[members.length - 1]?.id === tab.id;
      groupId = wasLast ? null : prevGroup;
    }
  }
  return { kind: 'tab', tabId: tab.id, before: anchorOf(next), groupId };
}
