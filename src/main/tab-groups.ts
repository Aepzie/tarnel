import { randomUUID } from 'node:crypto';
import { SPACE_COLORS, type SpaceColor, type SpaceId, type TabGroup, type TabGroupId, type TabGroupInput } from '../shared/types';

/**
 * Tab groups: named, colored, collapsible runs of tabs inside one Space.
 *
 * Membership lives on the tab (`Tab.groupId` in tabs.ts); this module owns the group records and the
 * ordering rules. Invariants, enforced by `clusterGroups` every time tabs.ts normalizes its order:
 * pinned tabs are never grouped, and the members of a group are contiguous. A group's position is
 * the position of its first tab, so moving a group = moving its tabs. Empty groups are pruned on emit.
 */

/** Persisted with each grouped tab in the session file (the group's space is the tab's space). */
export type SavedGroup = Pick<TabGroup, 'id' | 'name' | 'color' | 'collapsed'>;

export interface GroupTabView {
  spaceId: SpaceId;
  pinned: boolean;
  groupId: TabGroupId | null;
}

/** The slice of tabs.ts this module needs. Bound once by tabs.ts (no import cycle). */
export interface GroupTabModel {
  order(): readonly number[];
  tab(id: number): GroupTabView | undefined;
  /** Joining a group unpins the tab. */
  setGroupId(id: number, groupId: TabGroupId | null): void;
  /** Replace the tab order; tabs.ts re-normalizes (pinned first, groups contiguous) and emits. */
  commitOrder(ids: number[]): void;
  activeTabId(): number | null;
  activeSpaceId(): SpaceId;
  activate(id: number): void;
  close(id: number): void;
  create(opts: { spaceId: SpaceId; afterId?: number; groupId?: TabGroupId }): number;
  emit(): void;
}

const NAME_MAX = 64;
/** New groups take the first color of this order not yet used in their space (slate, the quietest, last). */
const COLOR_ORDER: readonly SpaceColor[] = ['blue', 'violet', 'pink', 'orange', 'green', 'teal', 'red', 'slate'];
const groups = new Map<TabGroupId, TabGroup>();
let model: GroupTabModel | null = null;

export function bindGroupModel(next: GroupTabModel): void {
  model = next;
}

function tabs(): GroupTabModel {
  if (!model) throw new Error('Tab model not bound');
  return model;
}

export function getGroup(id: TabGroupId): TabGroup | undefined {
  return groups.get(id);
}

/**
 * Keep every group's tabs together, at the position of the group's first tab. Ungrouped tabs keep
 * their relative order, so a stray ungrouped tab dropped inside a group lands right after it.
 */
export function clusterGroups(ids: readonly number[], groupOf: (id: number) => TabGroupId | null): number[] {
  const members = new Map<TabGroupId, number[]>();
  for (const id of ids) {
    const group = groupOf(id);
    if (!group) continue;
    const list = members.get(group);
    if (list) list.push(id);
    else members.set(group, [id]);
  }
  if (members.size === 0) return [...ids];
  const out: number[] = [];
  const placed = new Set<TabGroupId>();
  for (const id of ids) {
    const group = groupOf(id);
    if (!group) out.push(id);
    else if (!placed.has(group)) {
      placed.add(group);
      out.push(...members.get(group)!);
    }
  }
  return out;
}

/** Non-empty groups in display order (by their first tab), as fresh objects for BrowserState. */
export function groupsInOrder(ids: readonly number[], groupOf: (id: number) => TabGroupId | null): TabGroup[] {
  const out: TabGroup[] = [];
  const seen = new Set<TabGroupId>();
  for (const id of ids) {
    const group = groupOf(id);
    if (!group || seen.has(group)) continue;
    seen.add(group);
    const record = groups.get(group);
    if (record) out.push({ ...record });
  }
  return out;
}

/** Drop groups that no longer have any tab. */
export function pruneGroups(live: ReadonlySet<TabGroupId>): void {
  for (const id of groups.keys()) if (!live.has(id)) groups.delete(id);
}

export function savedGroup(id: TabGroupId | null): SavedGroup | undefined {
  const group = id ? groups.get(id) : undefined;
  return group && { id: group.id, name: group.name, color: group.color, collapsed: group.collapsed };
}

/** Re-register a group from the session file; returns its id, or null when the entry is invalid. */
export function restoreGroup(spaceId: SpaceId, saved: unknown): TabGroupId | null {
  if (!saved || typeof saved !== 'object') return null;
  const raw = saved as Partial<SavedGroup>;
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > NAME_MAX) return null;
  const existing = groups.get(raw.id);
  if (existing) return existing.spaceId === spaceId ? existing.id : null;
  groups.set(raw.id, {
    id: raw.id,
    spaceId,
    name: typeof raw.name === 'string' ? raw.name.slice(0, NAME_MAX) : '',
    color: SPACE_COLORS.includes(raw.color as SpaceColor) ? (raw.color as SpaceColor) : 'slate',
    collapsed: raw.collapsed === true,
  });
  return raw.id;
}

/** First palette color not used by another group of the space (cycles once all are taken). */
function nextColor(spaceId: SpaceId): SpaceColor {
  const used = new Map<SpaceColor, number>();
  for (const group of groups.values()) if (group.spaceId === spaceId) used.set(group.color, (used.get(group.color) ?? 0) + 1);
  let best: SpaceColor = COLOR_ORDER[0]!;
  let bestCount = Infinity;
  for (const color of COLOR_ORDER) {
    const count = used.get(color) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

function membersOf(groupId: TabGroupId): number[] {
  const model = tabs();
  return model.order().filter((id) => model.tab(id)?.groupId === groupId);
}

/** Index in `ids` to insert before `beforeTabId`; falls back to right after the space's last tab. */
function insertionIndex(ids: readonly number[], beforeTabId: number | null, spaceId: SpaceId): number {
  const model = tabs();
  if (beforeTabId !== null && model.tab(beforeTabId)?.spaceId === spaceId) {
    const index = ids.indexOf(beforeTabId);
    if (index !== -1) return index;
  }
  for (let i = ids.length - 1; i >= 0; i--) if (model.tab(ids[i]!)?.spaceId === spaceId) return i + 1;
  return ids.length;
}

function sameSpaceTabs(tabIds: readonly number[], spaceId: SpaceId): number[] {
  const model = tabs();
  return [...new Set(tabIds)].filter((id) => model.tab(id)?.spaceId === spaceId);
}

/** Group `tabIds` (all in the first tab's space) into a new group placed where the first of them is. */
export function createGroup(tabIds: readonly number[], input: Partial<TabGroupInput> = {}): TabGroupId {
  const model = tabs();
  const first = tabIds.map((id) => model.tab(id)).find((tab) => !!tab);
  if (!first) throw new Error('No tabs to group');
  const selected = new Set(sameSpaceTabs(tabIds, first.spaceId));
  const id = randomUUID();
  groups.set(id, {
    id,
    spaceId: first.spaceId,
    name: (input.name ?? '').slice(0, NAME_MAX),
    color: input.color ?? nextColor(first.spaceId),
    collapsed: input.collapsed === true,
  });
  const order = model.order();
  const anchor = order.findIndex((tabId) => selected.has(tabId));
  const moving = order.filter((tabId) => selected.has(tabId));
  const rest = order.filter((tabId) => !selected.has(tabId));
  const before = order.slice(0, anchor).filter((tabId) => !selected.has(tabId)).length;
  rest.splice(before, 0, ...moving);
  for (const tabId of moving) model.setGroupId(tabId, id);
  model.commitOrder(rest);
  return id;
}

/** Add tabs (of the group's space) to the end of a group. */
export function addTabsToGroup(groupId: TabGroupId, tabIds: readonly number[]): void {
  const group = groups.get(groupId);
  if (!group) return;
  const model = tabs();
  const moving = new Set(sameSpaceTabs(tabIds, group.spaceId).filter((id) => model.tab(id)?.groupId !== groupId));
  if (moving.size === 0) return;
  const rest = model.order().filter((id) => !moving.has(id));
  const last = rest.reduce((at, id, index) => (model.tab(id)?.groupId === groupId ? index : at), -1);
  const ordered = model.order().filter((id) => moving.has(id));
  rest.splice(last === -1 ? insertionIndex(rest, null, group.spaceId) : last + 1, 0, ...ordered);
  for (const id of ordered) model.setGroupId(id, groupId);
  model.commitOrder(rest);
}

/** Take tabs out of their groups; each lands right after the group it left. */
export function removeTabsFromGroups(tabIds: readonly number[]): void {
  const model = tabs();
  let order = [...model.order()];
  let changed = false;
  for (const id of new Set(tabIds)) {
    const groupId = model.tab(id)?.groupId;
    if (!groupId) continue;
    order = order.filter((tabId) => tabId !== id);
    const last = order.reduce((at, tabId, index) => (model.tab(tabId)?.groupId === groupId ? index : at), -1);
    order.splice(last === -1 ? order.length : last + 1, 0, id);
    model.setGroupId(id, null);
    changed = true;
  }
  if (changed) model.commitOrder(order);
}

export function updateGroup(groupId: TabGroupId, patch: Partial<TabGroupInput>): void {
  const group = groups.get(groupId);
  if (!group) return;
  const next: TabGroup = {
    ...group,
    ...(patch.name === undefined ? {} : { name: patch.name.slice(0, NAME_MAX) }),
    ...(patch.color === undefined ? {} : { color: patch.color }),
    ...(patch.collapsed === undefined ? {} : { collapsed: patch.collapsed }),
  };
  if (next.name === group.name && next.color === group.color && next.collapsed === group.collapsed) return;
  groups.set(groupId, next);
  tabs().emit();
}

/** Collapse / expand every group of the active space. */
export function setAllGroupsCollapsed(collapsed: boolean): void {
  const spaceId = tabs().activeSpaceId();
  let changed = false;
  for (const group of groups.values()) {
    if (group.spaceId !== spaceId || group.collapsed === collapsed) continue;
    groups.set(group.id, { ...group, collapsed });
    changed = true;
  }
  if (changed) tabs().emit();
}

export function ungroup(groupId: TabGroupId): void {
  if (!groups.has(groupId)) return;
  const model = tabs();
  for (const id of membersOf(groupId)) model.setGroupId(id, null);
  groups.delete(groupId);
  model.commitOrder([...model.order()]);
}

/** Close every tab of the group. When it holds the active tab, the nearest tab outside it takes over. */
export function closeGroup(groupId: TabGroupId): void {
  const group = groups.get(groupId);
  if (!group) return;
  const model = tabs();
  const members = membersOf(groupId);
  const active = model.activeTabId();
  if (active !== null && members.includes(active)) {
    const space = model.order().filter((id) => model.tab(id)?.spaceId === group.spaceId);
    const start = space.indexOf(members[0]!);
    const after = space.slice(start).find((id) => !members.includes(id));
    const before = space.slice(0, start).reverse().find((id) => !members.includes(id));
    const fallback = after ?? before;
    if (fallback !== undefined) model.activate(fallback);
    else model.create({ spaceId: group.spaceId });
  }
  for (const id of members) model.close(id);
}

/** Move the whole group before `beforeTabId` (null = end of the group's space). */
export function moveGroup(groupId: TabGroupId, beforeTabId: number | null): void {
  const group = groups.get(groupId);
  if (!group) return;
  const model = tabs();
  const members = membersOf(groupId);
  if (members.length === 0 || (beforeTabId !== null && members.includes(beforeTabId))) return;
  const rest = model.order().filter((id) => !members.includes(id));
  rest.splice(insertionIndex(rest, beforeTabId, group.spaceId), 0, ...members);
  model.commitOrder(rest);
}

/** Drag & drop of a single tab: position it and set its membership in one step. */
export function placeTab(tabId: number, beforeTabId: number | null, groupId: TabGroupId | null): void {
  const model = tabs();
  const tab = model.tab(tabId);
  if (!tab || beforeTabId === tabId) return;
  const group = groupId ? groups.get(groupId) : undefined;
  if (groupId && group?.spaceId !== tab.spaceId) return;
  model.setGroupId(tabId, group ? group.id : null);
  const rest = model.order().filter((id) => id !== tabId);
  rest.splice(insertionIndex(rest, beforeTabId, tab.spaceId), 0, tabId);
  model.commitOrder(rest);
}

/** Open a new tab at the end of the group. */
export function newTabInGroup(groupId: TabGroupId): number | null {
  const group = groups.get(groupId);
  if (!group) return null;
  const members = membersOf(groupId);
  return tabs().create({ spaceId: group.spaceId, afterId: members[members.length - 1], groupId });
}
