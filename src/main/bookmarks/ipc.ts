import type { IpcMainInvokeEvent } from 'electron';
import { BOOKMARKS_IPC, MAX_BOOKMARK_TITLE, MAX_BOOKMARK_URL, type BookmarkInput, type BookmarkUpdate, type BookmarksSnapshot } from '../../shared/bookmarks-ipc';
import type { SpaceId } from '../../shared/types';
import { getActiveSpaceId, getSpace } from '../spaces';
import { createTab, getTabSpaceId, tabIdForWebContents } from '../tabs';
import { addBookmark, listBookmarks, removeBookmark, searchBookmarks, updateBookmark } from './index';

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

const MAX_ID = 128;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid object');
  return value as Record<string, unknown>;
}

function nodeId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID) throw new TypeError('Invalid bookmark id');
  return value;
}

function optString(value: unknown, max: number, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new TypeError(`Invalid ${name}`);
  return value;
}

function optIndex(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) throw new TypeError('Invalid index');
  return value;
}

function bookmarkInput(value: unknown): BookmarkInput {
  const raw = record(value);
  if (raw.kind !== 'folder' && raw.kind !== 'bookmark') throw new TypeError('Invalid kind');
  const input: BookmarkInput = {
    parentId: nodeId(raw.parentId),
    kind: raw.kind,
    title: optString(raw.title, MAX_BOOKMARK_TITLE * 4, 'title') ?? '',
  };
  const url = optString(raw.url, MAX_BOOKMARK_URL, 'url');
  if (url !== undefined) input.url = url;
  const index = optIndex(raw.index);
  if (index !== undefined) input.index = index;
  return input;
}

function bookmarkUpdate(value: unknown): BookmarkUpdate {
  const raw = record(value);
  const patch: BookmarkUpdate = {};
  const title = optString(raw.title, MAX_BOOKMARK_TITLE * 4, 'title');
  if (title !== undefined) patch.title = title;
  const url = optString(raw.url, MAX_BOOKMARK_URL, 'url');
  if (url !== undefined) patch.url = url;
  if (raw.parentId !== undefined && raw.parentId !== null) patch.parentId = nodeId(raw.parentId);
  const index = optIndex(raw.index);
  if (index !== undefined) patch.index = index;
  return patch;
}

function knownSpace(value: unknown, fallback: () => SpaceId | null): SpaceId {
  if (value === undefined || value === null) {
    const id = fallback();
    if (!id) throw new Error('No space');
    return id;
  }
  if (typeof value !== 'string' || !getSpace(value)) throw new TypeError('Invalid space id');
  return value;
}

function limitOf(value: unknown): number {
  if (value === undefined || value === null) return 20;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 200) throw new TypeError('Invalid limit');
  return value;
}

function query(value: unknown): string {
  return optString(value, 500, 'query') ?? '';
}

export function registerBookmarksIpc(handleChrome: ChromeHandler, handlePages: PagesHandler): void {
  const active = (): SpaceId => getActiveSpaceId();
  const snapshot = (spaceId: SpaceId): BookmarksSnapshot => ({ spaceId, nodes: listBookmarks(spaceId) });

  handleChrome(BOOKMARKS_IPC.chromeList, (space) => snapshot(knownSpace(space, active)));
  handleChrome(BOOKMARKS_IPC.chromeAdd, (input, space) => addBookmark(knownSpace(space, active), bookmarkInput(input)));
  handleChrome(BOOKMARKS_IPC.chromeUpdate, (id, patch, space) => updateBookmark(knownSpace(space, active), nodeId(id), bookmarkUpdate(patch)));
  handleChrome(BOOKMARKS_IPC.chromeRemove, (id, space) => removeBookmark(knownSpace(space, active), nodeId(id)));
  handleChrome(BOOKMARKS_IPC.chromeSearch, (text, limit, space) => searchBookmarks(knownSpace(space, active), query(text), limitOf(limit)));
  handleChrome(BOOKMARKS_IPC.chromeOpenManager, () => {
    createTab({ url: 'vela://bookmarks/', spaceId: getActiveSpaceId(), active: true });
  });

  const hostSpace = (event: IpcMainInvokeEvent) => (): SpaceId | null => {
    const tabId = tabIdForWebContents(event.sender.id);
    return tabId === null ? null : getTabSpaceId(tabId);
  };
  handlePages(BOOKMARKS_IPC.pagesList, (event, space) => snapshot(knownSpace(space, hostSpace(event))));
  handlePages(BOOKMARKS_IPC.pagesAdd, (event, input, space) => addBookmark(knownSpace(space, hostSpace(event)), bookmarkInput(input)));
  handlePages(BOOKMARKS_IPC.pagesUpdate, (event, id, patch, space) =>
    updateBookmark(knownSpace(space, hostSpace(event)), nodeId(id), bookmarkUpdate(patch)),
  );
  handlePages(BOOKMARKS_IPC.pagesRemove, (event, id, space) => removeBookmark(knownSpace(space, hostSpace(event)), nodeId(id)));
  handlePages(BOOKMARKS_IPC.pagesSearch, (event, text, limit, space) =>
    searchBookmarks(knownSpace(space, hostSpace(event)), query(text), limitOf(limit)),
  );
}
