import { Star } from 'lucide-react';
import { useActiveTab } from '@/hooks/browser';
import { cn } from '@/lib/utils';
import { ui } from '../ui-store';
import { bookmarkForUrl, isBookmarkable, useBookmarks } from './bookmarks-store';

/** Star next to the palette's site chip: opens the bookmark popover (adds the page if needed). */
export function BookmarkStar() {
  const tab = useActiveTab();
  const nodes = useBookmarks();
  if (!tab || !isBookmarkable(tab.url)) return null;
  const saved = !!bookmarkForUrl(nodes, tab.url);
  return (
    <button
      type="button"
      title={saved ? 'Edit bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
      aria-label={saved ? 'Edit bookmark' : 'Bookmark this page'}
      aria-pressed={saved}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => ui.openBookmarkEditor()}
      className={cn(
        'no-drag grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors duration-150 hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:scale-[0.96] light:hover:bg-black/[0.05]',
        saved && 'text-space hover:text-space',
      )}
    >
      <Star className="size-3.5" strokeWidth={1.75} fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
}
