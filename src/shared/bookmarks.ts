/**
 * Bookmarks contract shared by the bookmark store (src/main/bookmarks), the browser-import feature and the UI.
 * Bookmarks belong to a Space (Spaces are separate identities).
 */
import type { SpaceId } from './types';

export interface BookmarkNode {
  id: string;
  spaceId: SpaceId;
  /** null for the Space's root folders. */
  parentId: string | null;
  kind: 'folder' | 'bookmark';
  title: string;
  /** Present for kind === 'bookmark'. */
  url?: string;
  /** Epoch ms. */
  addedAt: number;
  /** Position inside the parent folder. */
  index: number;
}

/** A bookmark tree read from another browser, before it gets Tarnel ids. */
export interface ImportedBookmark {
  title: string;
  url?: string;
  addedAt?: number;
  /** Present (possibly empty) for folders. */
  children?: ImportedBookmark[];
}
