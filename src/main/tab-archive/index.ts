import { randomUUID } from 'node:crypto';
import {
  TAB_ARCHIVE_IPC,
  addArchived,
  removeArchived,
  searchArchived,
  type ArchivedTab,
  type TabArchiveSnapshot,
} from '../../shared/tab-archive';
import type { SpaceId, Suggestion } from '../../shared/types';
import { getSettings } from '../settings';
import { getActiveSpaceId, getSpace, listSpaces, onSpacesChanged } from '../spaces';
import { createStore, type JsonStore } from '../store';
import { hasActiveDownload } from '../perf/sleeper';
import { restoreGroup } from '../tab-groups';
import { createTab, detachTabsForArchive, getActiveTab, listArchiveCandidates, listClosedTabs, reopenClosedById, tabIdsInGroup } from '../tabs';
import { sendToChrome } from '../window';
import { archiveAfterMs, pickArchiveTargets } from './policy';

/**
 * Per-Space tab archive. Persistent Spaces are stored in tab-archive.json; Burner Spaces live in
 * memory only and vanish with the Space.
 */

interface Persisted {
  spaces: Record<SpaceId, ArchivedTab[]>;
}

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

const MAX_IDS = 1000;
const MAX_ID = 128;

let store: JsonStore<Persisted> | null = null;
const burner = new Map<SpaceId, ArchivedTab[]>();
let spacesHooked = false;

function getStore(): JsonStore<Persisted> {
  store ??= createStore<Persisted>('tab-archive', { spaces: {} });
  return store;
}

function isBurner(spaceId: SpaceId): boolean {
  return getSpace(spaceId)?.ephemeral === true;
}

function read(spaceId: SpaceId): ArchivedTab[] {
  if (isBurner(spaceId)) return burner.get(spaceId) ?? [];
  const list = getStore().get().spaces[spaceId];
  return Array.isArray(list) ? list : [];
}

function write(spaceId: SpaceId, list: ArchivedTab[]): void {
  if (isBurner(spaceId)) {
    if (list.length === 0) burner.delete(spaceId);
    else burner.set(spaceId, list);
  } else {
    getStore().update((current) => {
      const spaces = { ...current.spaces };
      if (list.length === 0) delete spaces[spaceId];
      else spaces[spaceId] = list;
      return { ...current, spaces };
    });
  }
  sendToChrome(TAB_ARCHIVE_IPC.changed, spaceId);
}

/** Drop archives of Spaces that no longer exist (removed Space, wiped Burner). */
function pruneRemovedSpaces(): void {
  const live = new Set(listSpaces().map((space) => space.id));
  for (const id of burner.keys()) if (!live.has(id)) burner.delete(id);
  const spaces = getStore().get().spaces;
  const stale = Object.keys(spaces).filter((id) => !live.has(id));
  if (stale.length === 0) return;
  getStore().update((current) => {
    const next = { ...current.spaces };
    for (const id of stale) delete next[id];
    return { ...current, spaces: next };
  });
}

function hookSpaces(): void {
  if (spacesHooked) return;
  spacesHooked = true;
  onSpacesChanged(pruneRemovedSpaces);
}

/** Archive tabs (manual or auto); returns how many were archived. */
export function archiveTabs(tabIds: readonly number[], reason: ArchivedTab['reason']): number {
  hookSpaces();
  const detached = detachTabsForArchive(tabIds);
  if (detached.length === 0) return 0;
  const now = Date.now();
  const bySpace = new Map<SpaceId, ArchivedTab[]>();
  for (const tab of detached) {
    const entry: ArchivedTab = { id: randomUUID(), archivedAt: now, reason, ...tab };
    bySpace.set(tab.spaceId, [...(bySpace.get(tab.spaceId) ?? []), entry]);
  }
  for (const [spaceId, entries] of bySpace) write(spaceId, addArchived(read(spaceId), entries));
  return detached.length;
}

export function archiveActiveTab(): void {
  const id = getActiveTab();
  if (id !== null) archiveTabs([id], 'manual');
}

/** Called from the sleeper tick: archive tabs idle longer than the setting. */
export function runAutoArchive(now = Date.now()): void {
  const afterMs = archiveAfterMs(getSettings().archiveAfterHours);
  if (afterMs <= 0) return;
  const targets = pickArchiveTargets(
    listArchiveCandidates().map((tab) => ({ ...tab, downloading: hasActiveDownload(tab.id) })),
    now,
    afterMs,
  );
  if (targets.length > 0) archiveTabs(targets, 'auto');
}

export function getArchiveSnapshot(spaceId: SpaceId): TabArchiveSnapshot {
  return { spaceId, archived: read(spaceId), closed: listClosedTabs(spaceId) };
}

export function restoreArchived(spaceId: SpaceId, ids: ReadonlySet<string>): number {
  const list = read(spaceId);
  const picked = list.filter((entry) => ids.has(entry.id));
  if (picked.length === 0) return 0;
  write(spaceId, removeArchived(list, ids));
  const focus = picked.length === 1;
  // Oldest first so the restored tabs keep their original relative order at the end of the strip.
  for (const entry of [...picked].reverse()) {
    const groupId = entry.group ? restoreGroup(spaceId, { ...entry.group, collapsed: false }) : null;
    createTab({
      url: entry.url,
      spaceId,
      title: entry.title,
      favicon: entry.favicon,
      groupId,
      active: focus,
      asleep: !focus,
    });
  }
  return picked.length;
}

export function removeArchivedEntries(spaceId: SpaceId, ids: ReadonlySet<string>): void {
  const list = read(spaceId);
  const next = removeArchived(list, ids);
  if (next.length !== list.length) write(spaceId, next);
}

export function clearArchive(spaceId: SpaceId): void {
  if (read(spaceId).length > 0) write(spaceId, []);
}

/** Palette suggestions from the active Space's archive. */
export function archiveSuggestions(input: string, limit: number): Suggestion[] {
  const spaceId = getActiveSpaceId();
  if (!spaceId) return [];
  return searchArchived(read(spaceId), input)
    .slice(0, limit)
    .map((entry) => ({ kind: 'archived', title: entry.title || entry.url, url: entry.url, archiveId: entry.id, archivedAt: entry.archivedAt }));
}

// ---------------------------------------------------------------------------
// IPC

function spaceArg(value: unknown): SpaceId {
  if (value === undefined || value === null) {
    const id = getActiveSpaceId();
    if (!id) throw new Error('No space');
    return id;
  }
  if (typeof value !== 'string' || !getSpace(value)) throw new TypeError('Invalid space id');
  return value;
}

function idList(value: unknown): Set<string> {
  if (!Array.isArray(value) || value.length > MAX_IDS) throw new TypeError('Invalid ids');
  for (const id of value) if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID) throw new TypeError('Invalid id');
  return new Set(value as string[]);
}

function tabIdList(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > MAX_IDS) throw new TypeError('Invalid tab ids');
  for (const id of value) if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new TypeError('Invalid tab id');
  return value as number[];
}

export function registerTabArchiveIpc(handleChrome: ChromeHandler): void {
  hookSpaces();
  const C = TAB_ARCHIVE_IPC;
  handleChrome(C.list, (spaceId) => getArchiveSnapshot(spaceArg(spaceId)));
  handleChrome(C.archiveTabs, (tabIds) => archiveTabs(tabIdList(tabIds), 'manual'));
  handleChrome(C.archiveGroup, (groupId) => {
    if (typeof groupId !== 'string' || groupId.length === 0 || groupId.length > MAX_ID) throw new TypeError('Invalid group id');
    return archiveTabs(tabIdsInGroup(groupId), 'manual');
  });
  handleChrome(C.restore, (ids, spaceId) => restoreArchived(spaceArg(spaceId), idList(ids)));
  handleChrome(C.remove, (ids, spaceId) => removeArchivedEntries(spaceArg(spaceId), idList(ids)));
  handleChrome(C.clear, (spaceId) => clearArchive(spaceArg(spaceId)));
  handleChrome(C.reopenClosed, (id) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID) throw new TypeError('Invalid id');
    reopenClosedById(id);
  });
}
