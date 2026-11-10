import type { BookmarkNode, ImportedBookmark } from '../../shared/bookmarks';
import { BOOKMARKS_IPC, type BookmarkInput, type BookmarkUpdate } from '../../shared/bookmarks-ipc';
import type { SpaceId, Suggestion } from '../../shared/types';
import { getActiveSpaceId, getSpace, listSpaces, onSpacesChanged } from '../spaces';
import { createStore, type JsonStore } from '../store';
import { sendToChrome } from '../window';
import { addNode, findByUrl, importNodes, normalizeTree, removeNode, searchNodes, updateNode } from './tree';

/**
 * Bookmarks per Space. Persistent Spaces share one JSON store keyed by Space id (atomic writes via
 * createStore); burner Spaces keep theirs in memory only and lose them with the Space.
 */

type Persisted = Record<SpaceId, BookmarkNode[]>;

let store: JsonStore<Persisted> | null = null;
const memory = new Map<SpaceId, BookmarkNode[]>();
const cache = new Map<SpaceId, BookmarkNode[]>();
let pruneHooked = false;

function getStore(): JsonStore<Persisted> {
  store ??= createStore<Persisted>('bookmarks', {});
  if (!pruneHooked) {
    pruneHooked = true;
    onSpacesChanged(pruneRemovedSpaces);
  }
  return store;
}

function pruneRemovedSpaces(): void {
  const alive = new Set(listSpaces().map((space) => space.id));
  for (const id of [...memory.keys()]) if (!alive.has(id)) memory.delete(id);
  for (const id of [...cache.keys()]) if (!alive.has(id)) cache.delete(id);
  const persisted = getStore().get();
  const stale = Object.keys(persisted).filter((id) => !alive.has(id));
  if (stale.length === 0) return;
  getStore().update((current) => {
    const next = { ...current };
    for (const id of stale) delete next[id];
    return next;
  });
}

function requireSpace(spaceId: SpaceId): { ephemeral: boolean } {
  const space = getSpace(spaceId);
  if (!space) throw new Error('Unknown space');
  return space;
}

function read(spaceId: SpaceId): BookmarkNode[] {
  const space = requireSpace(spaceId);
  if (space.ephemeral) {
    const current = memory.get(spaceId) ?? normalizeTree(spaceId, []);
    memory.set(spaceId, current);
    return current;
  }
  const cached = cache.get(spaceId);
  if (cached) return cached;
  const nodes = normalizeTree(spaceId, getStore().get()[spaceId]);
  cache.set(spaceId, nodes);
  return nodes;
}

function write(spaceId: SpaceId, nodes: BookmarkNode[]): void {
  const space = requireSpace(spaceId);
  if (space.ephemeral) memory.set(spaceId, nodes);
  else {
    cache.set(spaceId, nodes);
    getStore().update((current) => ({ ...current, [spaceId]: nodes }));
  }
  sendToChrome(BOOKMARKS_IPC.changed, spaceId);
}

export function listBookmarks(spaceId: SpaceId): BookmarkNode[] {
  return read(spaceId);
}

export function addBookmark(spaceId: SpaceId, input: BookmarkInput): BookmarkNode {
  const result = addNode(read(spaceId), spaceId, input);
  write(spaceId, result.nodes);
  return result.node;
}

export function updateBookmark(spaceId: SpaceId, id: string, patch: BookmarkUpdate): BookmarkNode {
  const next = updateNode(read(spaceId), id, patch);
  write(spaceId, next);
  return next.find((node) => node.id === id)!;
}

export function removeBookmark(spaceId: SpaceId, id: string): void {
  write(spaceId, removeNode(read(spaceId), id));
}

export function searchBookmarks(spaceId: SpaceId, query: string, limit: number): BookmarkNode[] {
  return searchNodes(read(spaceId), query, limit);
}

export function bookmarksForUrl(spaceId: SpaceId, url: string): BookmarkNode[] {
  return findByUrl(read(spaceId), url);
}

/** Address-bar / palette suggestions from the active Space's bookmarks. */
export function bookmarkSuggestions(input: string, limit: number): Suggestion[] {
  try {
    return searchBookmarks(getActiveSpaceId(), input, limit).map((node) => ({ kind: 'bookmark', title: node.title, url: node.url! }));
  } catch {
    return [];
  }
}

/** Replaces a Space's bookmarks wholesale (sync). Unknown Spaces are ignored. */
export function replaceSpaceBookmarks(spaceId: SpaceId, raw: unknown): void {
  if (!getSpace(spaceId)) return;
  write(spaceId, normalizeTree(spaceId, raw));
}

/** Persistent Spaces' bookmarks (sync). */
export function exportPersistentBookmarks(): Persisted {
  const out: Persisted = {};
  for (const space of listSpaces()) if (!space.ephemeral) out[space.id] = read(space.id);
  return out;
}

/**
 * Adds an imported tree to the Space as a new folder named `folderTitle` (e.g. "Imported from Chrome").
 * Resolves to the number of bookmarks added.
 */
export async function importBookmarkTree(spaceId: SpaceId, folderTitle: string, nodes: readonly ImportedBookmark[]): Promise<number> {
  const result = importNodes(read(spaceId), spaceId, folderTitle, Array.isArray(nodes) ? nodes : []);
  write(spaceId, result.nodes);
  return result.added;
}
