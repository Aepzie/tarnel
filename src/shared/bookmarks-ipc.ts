import type { BookmarkNode } from './bookmarks';
import type { SpaceId } from './types';

/** Fixed ids of the two root folders every Space has. */
export const BOOKMARK_ROOTS = {
  bar: 'root-bar',
  other: 'root-other',
} as const;

export const MAX_BOOKMARK_TITLE = 300;
export const MAX_BOOKMARK_URL = 8192;

/** chrome:* channels are only accepted from the browser chrome, pages:* only from tarnel:// pages. */
export const BOOKMARKS_IPC = {
  chromeList: 'chrome:bookmarks-list',
  chromeAdd: 'chrome:bookmarks-add',
  chromeUpdate: 'chrome:bookmarks-update',
  chromeRemove: 'chrome:bookmarks-remove',
  chromeSearch: 'chrome:bookmarks-search',
  chromeOpenManager: 'chrome:bookmarks-open-manager',
  changed: 'chrome-event:bookmarks',
  pagesList: 'pages:bookmarks-list',
  pagesAdd: 'pages:bookmarks-add',
  pagesUpdate: 'pages:bookmarks-update',
  pagesRemove: 'pages:bookmarks-remove',
  pagesSearch: 'pages:bookmarks-search',
} as const;

export interface BookmarkInput {
  parentId: string;
  kind: 'folder' | 'bookmark';
  title: string;
  url?: string;
  /** Position in the parent; omitted = append. */
  index?: number;
}

/**
 * Move = parentId and/or index. `index` is the drop position counted in the parent's children as
 * they are before the move (drop "before the child at index"); omitted = append.
 */
export interface BookmarkUpdate {
  title?: string;
  url?: string;
  parentId?: string;
  index?: number;
}

/** Bookmarks of one Space, flat (parentId + index); the chrome and tarnel://bookmarks build the tree. */
export interface BookmarksSnapshot {
  spaceId: SpaceId;
  nodes: BookmarkNode[];
}

export interface BookmarksAPI {
  /** All nodes of the Space (default: the active Space for the chrome, the hosting tab's Space for pages). */
  list(spaceId?: SpaceId): Promise<BookmarksSnapshot>;
  add(input: BookmarkInput, spaceId?: SpaceId): Promise<BookmarkNode>;
  update(id: string, patch: BookmarkUpdate, spaceId?: SpaceId): Promise<BookmarkNode>;
  /** Removes the node and, for folders, everything inside. */
  remove(id: string, spaceId?: SpaceId): Promise<void>;
  search(query: string, limit?: number, spaceId?: SpaceId): Promise<BookmarkNode[]>;
}

declare module './ipc' {
  interface VelaChromeAPI {
    bookmarks: BookmarksAPI & {
      /** A Space's bookmarks changed (any window, page or import). */
      onChange(cb: (spaceId: SpaceId) => void): () => void;
      /** Opens tarnel://bookmarks in a new tab of the active Space. */
      openManager(): Promise<void>;
    };
  }
  interface VelaPagesAPI {
    bookmarks: BookmarksAPI;
  }
}
