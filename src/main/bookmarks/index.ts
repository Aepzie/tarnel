import type { ImportedBookmark } from '../../shared/bookmarks';
import type { SpaceId } from '../../shared/types';

/**
 * Adds an imported tree to the Space as a new folder named `folderTitle` (e.g. "Imported from Chrome").
 * Resolves to the number of bookmarks added. Implemented by the bookmarks feature.
 */
export async function importBookmarkTree(spaceId: SpaceId, folderTitle: string, nodes: readonly ImportedBookmark[]): Promise<number> {
  void spaceId;
  void folderTitle;
  void nodes;
  throw new Error('Bookmarks are not available yet.');
}
