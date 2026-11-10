import { useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { ChevronDown, ChevronsRight, Folder, FolderOpen } from 'lucide-react';
import type { BookmarkNode } from '@shared/bookmarks';
import { BOOKMARK_ROOTS } from '@shared/bookmarks-ipc';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getBrowserStateSnapshot, useSettings } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { letterOf, settle } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { childrenOf, useBookmarks } from './bookmarks-store';

const OVERFLOW_RESERVE = 132;
const DRAG_TYPE = 'application/x-vela-bookmark';

function openBookmark(url: string, newTab: boolean): void {
  const { activeTabId } = getBrowserStateSnapshot();
  if (newTab || activeTabId === null) settle(window.vela.tabs.create({ url }));
  else settle(window.vela.tabs.navigate(activeTabId, url));
}

function openAll(nodes: readonly BookmarkNode[], folderId: string): void {
  for (const node of childrenOf(nodes, folderId)) {
    if (node.kind === 'bookmark' && node.url) settle(window.vela.tabs.create({ url: node.url, active: false }));
  }
}

/**
 * Optional bookmarks bar under the top island (Settings → Appearance, Ctrl+Shift+B). It is a plain
 * flex row in App's column, so the page viewport shrinks by its height automatically. Items that do
 * not fit move into the » menu; folders open as dropdowns; items can be dragged to reorder.
 */
export function BookmarksBar() {
  const { showBookmarksBar } = useSettings();
  if (!showBookmarksBar) return null;
  return <Bar />;
}

function Bar() {
  const nodes = useBookmarks();
  const rowRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(Number.POSITIVE_INFINITY);
  const [menus, setMenus] = useState(0);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  useOverlayPresence(menus > 0);
  const onMenu = (open: boolean): void => setMenus((count) => Math.max(0, count + (open ? 1 : -1)));

  const items = nodes ? childrenOf(nodes, BOOKMARK_ROOTS.bar) : [];
  const other = nodes ? childrenOf(nodes, BOOKMARK_ROOTS.other) : [];
  const itemsKey = items.map((node) => `${node.id}:${node.title}`).join('|');

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = (): void => {
      const limit = row.clientWidth - OVERFLOW_RESERVE;
      const children = [...row.querySelectorAll<HTMLElement>('[data-bar-item]')];
      const fit = children.findIndex((child) => child.offsetLeft + child.offsetWidth > limit);
      setVisibleCount(fit === -1 ? Number.POSITIVE_INFINITY : fit);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [itemsKey]);

  const hidden = Number.isFinite(visibleCount) ? items.slice(visibleCount) : [];

  const onDrop = (event: DragEvent<HTMLElement>, index: number): void => {
    const id = event.dataTransfer.getData(DRAG_TYPE);
    setDropIndex(null);
    if (!id) return;
    event.preventDefault();
    settle(window.vela.bookmarks.update(id, { parentId: BOOKMARK_ROOTS.bar, index }));
  };

  return (
    <nav
      aria-label="Bookmarks bar"
      className="no-drag relative flex h-7 shrink-0 items-center gap-0.5 px-1 text-[12px] text-muted-foreground"
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
      }}
    >
      <div ref={rowRef} className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {nodes && items.length === 0 && (
          <span className="px-2 text-[11.5px] text-muted-foreground/70">Bookmark pages with Ctrl+D to see them here</span>
        )}
        {items.map((node, index) => (
          <div
            key={node.id}
            data-bar-item
            className={cn('relative shrink-0', index >= visibleCount && 'invisible')}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TYPE, node.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              setDropIndex(event.clientX < rect.left + rect.width / 2 ? index : index + 1);
            }}
            onDrop={(event) => onDrop(event, dropIndex ?? index)}
            onDragEnd={() => setDropIndex(null)}
          >
            {dropIndex === index && <DropMarker side="left" />}
            {dropIndex === index + 1 && index === items.length - 1 && <DropMarker side="right" />}
            {node.kind === 'folder' ? (
              <FolderButton node={node} nodes={nodes!} onOpenChange={onMenu} />
            ) : (
              <BookmarkButton node={node} onOpenChange={onMenu} />
            )}
          </div>
        ))}
      </div>
      {hidden.length > 0 && (
        <DropdownMenu modal={false} onOpenChange={onMenu}>
          <DropdownMenuTrigger asChild>
            <button type="button" title="More bookmarks" className={barButton}>
              <ChevronsRight className="size-3.5" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} collisionPadding={8} className="max-h-[60vh] min-w-56 overflow-y-auto">
            <FolderEntries nodes={nodes!} entries={hidden} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {other.length > 0 && (
        <>
          <div aria-hidden className="mx-1 h-3.5 w-px shrink-0 bg-border" />
          <FolderButton node={nodes!.find((node) => node.id === BOOKMARK_ROOTS.other)!} nodes={nodes!} onOpenChange={onMenu} />
        </>
      )}
    </nav>
  );
}

const barButton =
  'flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/[0.07] data-[state=open]:text-foreground light:hover:bg-black/[0.05] light:data-[state=open]:bg-black/[0.06]';

function DropMarker({ side }: { side: 'left' | 'right' }) {
  return <span aria-hidden className={cn('absolute inset-y-1 w-0.5 rounded-full bg-space', side === 'left' ? '-left-[2px]' : '-right-[2px]')} />;
}

function Letter({ node }: { node: BookmarkNode }) {
  return (
    <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-secondary text-[9px] font-semibold text-muted-foreground ring-1 ring-border">
      {letterOf(node.url ?? '', node.title)}
    </span>
  );
}

function BookmarkButton({ node, onOpenChange }: { node: BookmarkNode; onOpenChange: (open: boolean) => void }) {
  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (node.url) openBookmark(node.url, event.ctrlKey || event.metaKey);
  };
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          title={`${node.title}\n${node.url ?? ''}`}
          className={barButton}
          onClick={onClick}
          onAuxClick={(event) => {
            if (event.button === 1 && node.url) openBookmark(node.url, true);
          }}
        >
          <Letter node={node} />
          <span className="truncate">{node.title}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem onSelect={() => node.url && openBookmark(node.url, true)}>Open in new tab</ContextMenuItem>
        <ContextMenuItem onSelect={() => settle(window.vela.bookmarks.openManager())}>Manage bookmarks</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => settle(window.vela.bookmarks.remove(node.id))}>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FolderButton({ node, nodes, onOpenChange }: { node: BookmarkNode; nodes: readonly BookmarkNode[]; onOpenChange: (open: boolean) => void }) {
  const entries = childrenOf(nodes, node.id);
  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" title={node.title} className={barButton}>
          <Folder className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{node.title}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} collisionPadding={8} className="max-h-[60vh] min-w-56 overflow-y-auto">
        {entries.length === 0 ? (
          <DropdownMenuItem disabled>Empty folder</DropdownMenuItem>
        ) : (
          <>
            <FolderEntries nodes={nodes} entries={entries} />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openAll(nodes, node.id)}>Open all in new tabs</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FolderEntries({ nodes, entries }: { nodes: readonly BookmarkNode[]; entries: readonly BookmarkNode[] }) {
  return (
    <>
      {entries.map((entry) =>
        entry.kind === 'folder' ? (
          <DropdownMenuSub key={entry.id}>
            <DropdownMenuSubTrigger className="gap-2">
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <span className="truncate">{entry.title}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-[60vh] min-w-52 overflow-y-auto">
              {childrenOf(nodes, entry.id).length === 0 ? (
                <DropdownMenuItem disabled>Empty folder</DropdownMenuItem>
              ) : (
                <FolderEntries nodes={nodes} entries={childrenOf(nodes, entry.id)} />
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem
            key={entry.id}
            className="gap-2"
            onSelect={() => openBookmark(entry.url!, false)}
            onAuxClick={(event) => {
              if (event.button === 1) openBookmark(entry.url!, true);
            }}
          >
            <Letter node={entry} />
            <span className="max-w-72 truncate">{entry.title}</span>
          </DropdownMenuItem>
        ),
      )}
    </>
  );
}
