import { useEffect, useSyncExternalStore } from 'react';
import type { BookmarkNode } from '@shared/bookmarks';
import type { BookmarksSnapshot } from '@shared/bookmarks-ipc';
import { useBrowserSlice } from '@/hooks/browser';

/**
 * Bookmarks of the active Space for the chrome (bar, star, editor). Loaded on demand and refreshed
 * when main reports a change for that Space or the active Space switches.
 */
let snapshot: BookmarksSnapshot | null = null;
let wanted: string | null = null;
let subscribed = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((cb) => cb());
}

function load(spaceId: string): void {
  wanted = spaceId;
  window.vela.bookmarks
    .list(spaceId)
    .then((next) => {
      if (wanted !== next.spaceId) return;
      snapshot = next;
      emit();
    })
    .catch(() => undefined);
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  window.vela.bookmarks.onChange((spaceId) => {
    if (spaceId === wanted) load(spaceId);
  });
}

export function useBookmarks(): BookmarkNode[] | null {
  const spaceId = useBrowserSlice((s) => s.activeSpaceId);
  useEffect(() => {
    ensureSubscribed();
    if (spaceId && spaceId !== wanted) load(spaceId);
  }, [spaceId]);
  const current = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
  return current && current.spaceId === spaceId ? current.nodes : null;
}

export function childrenOf(nodes: readonly BookmarkNode[], parentId: string | null): BookmarkNode[] {
  return nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.index - b.index);
}

function comparable(url: string): string {
  return url.replace(/#.*$/, '').replace(/\/$/, '');
}

export function bookmarkForUrl(nodes: readonly BookmarkNode[] | null, url: string | undefined): BookmarkNode | undefined {
  if (!nodes || !url) return undefined;
  const target = comparable(url);
  return nodes.find((node) => node.kind === 'bookmark' && !!node.url && comparable(node.url) === target);
}

export function isBookmarkable(url: string | undefined): url is string {
  return !!url && /^(https?|file):/i.test(url);
}

/** Folders as an indented list for pickers ("Bookmarks bar", "  Work", …). */
export function folderOptions(nodes: readonly BookmarkNode[]): { id: string; title: string; depth: number }[] {
  const out: { id: string; title: string; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const node of childrenOf(nodes, parentId)) {
      if (node.kind !== 'folder') continue;
      out.push({ id: node.id, title: node.title, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
