import { randomUUID } from 'node:crypto';
import type { BookmarkNode, ImportedBookmark } from '../../shared/bookmarks';
import { BOOKMARK_ROOTS, MAX_BOOKMARK_TITLE, MAX_BOOKMARK_URL } from '../../shared/bookmarks-ipc';
import type { SpaceId } from '../../shared/types';

/**
 * Pure operations on one Space's bookmarks, kept as a flat list of nodes (parentId + index).
 * Every function returns a new list and never mutates its input; invalid operations throw.
 */

export interface NewBookmark {
  parentId: string;
  kind: 'folder' | 'bookmark';
  title: string;
  url?: string;
  /** Position in the parent; omitted or out of range = append. */
  index?: number;
}

export interface BookmarkPatch {
  title?: string;
  url?: string;
  parentId?: string;
  index?: number;
}

const ROOT_IDS = new Set<string>([BOOKMARK_ROOTS.bar, BOOKMARK_ROOTS.other]);
const MAX_IMPORT_DEPTH = 32;

export function isRootId(id: string): boolean {
  return ROOT_IDS.has(id);
}

export function cleanTitle(title: unknown): string {
  return (typeof title === 'string' ? title : '').replace(/\s+/g, ' ').trim().slice(0, MAX_BOOKMARK_TITLE);
}

/** Bookmarkable URLs: web pages, vela:// pages and file:// documents. Returns null otherwise. */
export function cleanUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > MAX_BOOKMARK_URL) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:', 'vela:', 'file:'].includes(parsed.protocol)) return null;
  return parsed.href;
}

function rootNode(spaceId: SpaceId, id: string, title: string, index: number): BookmarkNode {
  return { id, spaceId, parentId: null, kind: 'folder', title, addedAt: 0, index };
}

/** Drops malformed nodes and orphans, adds missing root folders and normalises indexes. */
export function normalizeTree(spaceId: SpaceId, raw: unknown): BookmarkNode[] {
  const input = Array.isArray(raw) ? raw : [];
  const valid: BookmarkNode[] = [];
  const seen = new Set<string>();
  for (const candidate of input as Partial<BookmarkNode>[]) {
    if (!candidate || typeof candidate.id !== 'string' || seen.has(candidate.id)) continue;
    if (candidate.kind !== 'folder' && candidate.kind !== 'bookmark') continue;
    if (isRootId(candidate.id)) continue;
    if (typeof candidate.parentId !== 'string') continue;
    const url = candidate.kind === 'bookmark' ? cleanUrl(candidate.url) : null;
    if (candidate.kind === 'bookmark' && !url) continue;
    seen.add(candidate.id);
    const node: BookmarkNode = {
      id: candidate.id,
      spaceId,
      parentId: candidate.parentId,
      kind: candidate.kind,
      title: cleanTitle(candidate.title),
      addedAt: typeof candidate.addedAt === 'number' && Number.isFinite(candidate.addedAt) ? candidate.addedAt : 0,
      index: typeof candidate.index === 'number' && Number.isFinite(candidate.index) ? candidate.index : 0,
    };
    if (url) node.url = url;
    valid.push(node);
  }
  const roots = [rootNode(spaceId, BOOKMARK_ROOTS.bar, 'Bookmarks bar', 0), rootNode(spaceId, BOOKMARK_ROOTS.other, 'Other bookmarks', 1)];
  const byId = new Map<string, BookmarkNode>([...roots, ...valid].map((node) => [node.id, node]));
  const reachable = (node: BookmarkNode): boolean => {
    const visited = new Set<string>();
    let current: BookmarkNode | undefined = node;
    while (current && current.parentId !== null) {
      if (visited.has(current.id)) return false;
      visited.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent || parent.kind !== 'folder') return false;
      current = parent;
    }
    return !!current;
  };
  return reindexAll([...roots, ...valid.filter(reachable)]);
}

function reindexAll(nodes: BookmarkNode[]): BookmarkNode[] {
  const groups = new Map<string | null, BookmarkNode[]>();
  for (const node of nodes) {
    const list = groups.get(node.parentId) ?? [];
    list.push(node);
    groups.set(node.parentId, list);
  }
  const out: BookmarkNode[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.index - b.index);
    list.forEach((node, index) => out.push(node.index === index ? node : { ...node, index }));
  }
  return out;
}

export function childrenOf(nodes: readonly BookmarkNode[], parentId: string | null): BookmarkNode[] {
  return nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.index - b.index);
}

function requireFolder(nodes: readonly BookmarkNode[], id: string): BookmarkNode {
  const folder = nodes.find((node) => node.id === id);
  if (!folder || folder.kind !== 'folder') throw new Error('Folder not found');
  return folder;
}

function isInside(nodes: readonly BookmarkNode[], id: string, ancestorId: string): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(id);
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return false;
}

/** Puts `node` into `parentId` at `index` (clamped), shifting its new siblings. */
function place(nodes: readonly BookmarkNode[], node: BookmarkNode, parentId: string, index: number | undefined): BookmarkNode[] {
  const others = nodes.filter((other) => other.id !== node.id);
  const siblings = childrenOf(others, parentId);
  const at = index === undefined || !Number.isFinite(index) ? siblings.length : Math.max(0, Math.min(siblings.length, Math.floor(index)));
  siblings.splice(at, 0, { ...node, parentId });
  const placed = new Map(siblings.map((sibling, position) => [sibling.id, { ...sibling, index: position }]));
  const rest = others.filter((other) => !placed.has(other.id));
  return reindexAll([...rest, ...placed.values()]);
}

export function addNode(
  nodes: readonly BookmarkNode[],
  spaceId: SpaceId,
  input: NewBookmark,
  now = Date.now(),
): { nodes: BookmarkNode[]; node: BookmarkNode } {
  requireFolder(nodes, input.parentId);
  const node: BookmarkNode = {
    id: randomUUID(),
    spaceId,
    parentId: input.parentId,
    kind: input.kind,
    title: cleanTitle(input.title),
    addedAt: now,
    index: 0,
  };
  if (input.kind === 'bookmark') {
    const url = cleanUrl(input.url);
    if (!url) throw new TypeError('Invalid bookmark url');
    node.url = url;
    if (!node.title) node.title = url;
  } else if (!node.title) {
    node.title = 'New folder';
  }
  const next = place(nodes, node, input.parentId, input.index);
  return { nodes: next, node: next.find((candidate) => candidate.id === node.id)! };
}

export function updateNode(nodes: readonly BookmarkNode[], id: string, patch: BookmarkPatch): BookmarkNode[] {
  if (isRootId(id)) throw new Error('Root folders cannot be changed');
  const current = nodes.find((node) => node.id === id);
  if (!current) throw new Error('Bookmark not found');
  const next: BookmarkNode = { ...current };
  if (patch.title !== undefined) {
    const title = cleanTitle(patch.title);
    if (title) next.title = title;
  }
  if (patch.url !== undefined) {
    if (current.kind !== 'bookmark') throw new TypeError('Folders have no url');
    const url = cleanUrl(patch.url);
    if (!url) throw new TypeError('Invalid bookmark url');
    next.url = url;
  }
  const parentId = patch.parentId ?? current.parentId!;
  const moving = patch.parentId !== undefined || patch.index !== undefined;
  if (!moving) return nodes.map((node) => (node.id === id ? next : node));
  requireFolder(nodes, parentId);
  if (current.kind === 'folder' && isInside(nodes, parentId, id)) throw new Error('A folder cannot move into itself');
  const sameParent = parentId === current.parentId;
  const index = patch.index !== undefined && sameParent && patch.index > current.index ? patch.index - 1 : patch.index;
  return place(nodes, next, parentId, index);
}

/** Removes a node and everything below it. */
export function removeNode(nodes: readonly BookmarkNode[], id: string): BookmarkNode[] {
  if (isRootId(id)) throw new Error('Root folders cannot be removed');
  if (!nodes.some((node) => node.id === id)) return [...nodes];
  return reindexAll(nodes.filter((node) => !isInside(nodes, node.id, id)));
}

function normalizedForMatch(url: string): string {
  return url.replace(/#.*$/, '').replace(/\/$/, '');
}

export function findByUrl(nodes: readonly BookmarkNode[], url: string): BookmarkNode[] {
  const target = normalizedForMatch(url);
  return nodes.filter((node) => node.kind === 'bookmark' && !!node.url && normalizedForMatch(node.url) === target);
}

/** Bookmarks whose title or URL contain every query token; title-prefix matches first. */
export function searchNodes(nodes: readonly BookmarkNode[], query: string, limit: number): BookmarkNode[] {
  const tokens = query.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || limit <= 0) return [];
  const scored: { node: BookmarkNode; score: number }[] = [];
  for (const node of nodes) {
    if (node.kind !== 'bookmark' || !node.url) continue;
    const title = node.title.toLowerCase();
    const url = node.url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (!tokens.every((token) => title.includes(token) || url.includes(token))) continue;
    const first = tokens[0]!;
    const score = (url.startsWith(first) ? 2 : 0) + (title.startsWith(first) ? 1 : 0);
    scored.push({ node, score });
  }
  scored.sort((a, b) => b.score - a.score || b.node.addedAt - a.node.addedAt);
  return scored.slice(0, limit).map(({ node }) => node);
}

/**
 * Adds an imported tree as a new folder `folderTitle` at the end of "Other bookmarks".
 * Entries with unusable URLs are skipped. Returns the new list and how many bookmarks were added.
 */
export function importNodes(
  nodes: readonly BookmarkNode[],
  spaceId: SpaceId,
  folderTitle: string,
  imported: readonly ImportedBookmark[],
  now = Date.now(),
): { nodes: BookmarkNode[]; added: number } {
  const created: BookmarkNode[] = [];
  let added = 0;
  const folder: BookmarkNode = {
    id: randomUUID(),
    spaceId,
    parentId: BOOKMARK_ROOTS.other,
    kind: 'folder',
    title: cleanTitle(folderTitle) || 'Imported',
    addedAt: now,
    index: childrenOf(nodes, BOOKMARK_ROOTS.other).length,
  };
  created.push(folder);
  const walk = (entries: readonly ImportedBookmark[], parentId: string, depth: number): void => {
    let index = 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const addedAt = typeof entry.addedAt === 'number' && Number.isFinite(entry.addedAt) ? entry.addedAt : now;
      if (Array.isArray(entry.children)) {
        if (depth >= MAX_IMPORT_DEPTH) continue;
        const child: BookmarkNode = { id: randomUUID(), spaceId, parentId, kind: 'folder', title: cleanTitle(entry.title) || 'Folder', addedAt, index: index++ };
        created.push(child);
        walk(entry.children, child.id, depth + 1);
        continue;
      }
      const url = cleanUrl(entry.url);
      if (!url) continue;
      created.push({ id: randomUUID(), spaceId, parentId, kind: 'bookmark', title: cleanTitle(entry.title) || url, url, addedAt, index: index++ });
      added += 1;
    }
  };
  walk(imported, folder.id, 0);
  return { nodes: [...nodes, ...created], added };
}
