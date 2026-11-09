import { Columns2Icon, PanelRightIcon, SquareSplitHorizontalIcon } from 'lucide-react';
import type { TabState } from '@shared/types';
import { SPLIT_MAX_PANES } from '@shared/split-layout';
import { ContextMenuItem, ContextMenuPortal, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '@/components/ui/context-menu';
import { shallowEqual, useBrowserSlice } from '@/hooks/browser';
import { settle, vela } from '@/lib/vela';
import { Favicon } from '../tabs/Favicon';
import { MENU_ITEM, MENU_SEPARATOR, MENU_SURFACE } from '../tabs/menu-style';

const PICK_MAX = 12;

/** Tab context-menu entries for split view (with a trailing separator when anything is shown). */
export function SplitMenuItems({ tab }: { tab: TabState }) {
  const activeTabId = useBrowserSlice((s) => s.activeTabId);
  const activeSplit = useBrowserSlice((s) => s.splits.find((split) => split.tabIds.includes(s.activeTabId ?? -1)));
  const others = useBrowserSlice(
    (s) => s.tabs.filter((other) => other.spaceId === tab.spaceId && other.id !== tab.id).slice(0, PICK_MAX),
    shallowEqual,
  );

  if (tab.splitId) {
    const splitId = tab.splitId;
    return (
      <>
        <ContextMenuItem className={MENU_ITEM} onSelect={() => settle(vela().split.separate(tab.id))}>
          <PanelRightIcon strokeWidth={1.75} />
          Remove from split view
        </ContextMenuItem>
        <ContextMenuItem className={MENU_ITEM} onSelect={() => settle(vela().split.close(splitId))}>
          <Columns2Icon strokeWidth={1.75} />
          Close split view
        </ContextMenuItem>
        <ContextMenuSeparator className={MENU_SEPARATOR} />
      </>
    );
  }

  const canJoinCurrent = activeTabId !== null && activeTabId !== tab.id && (!activeSplit || activeSplit.tabIds.length < SPLIT_MAX_PANES);
  if (!canJoinCurrent && others.length === 0) return null;
  const joinCurrent = (): void => {
    if (activeTabId === null) return;
    if (activeSplit) settle(vela().split.add(activeSplit.id, tab.id, activeSplit.tabIds.length));
    else settle(vela().split.create([activeTabId, tab.id], tab.id));
  };

  return (
    <>
      {canJoinCurrent && (
        <ContextMenuItem className={MENU_ITEM} onSelect={joinCurrent}>
          <SquareSplitHorizontalIcon strokeWidth={1.75} />
          {activeSplit ? 'Add to split view' : 'Split with current tab'}
        </ContextMenuItem>
      )}
      {others.length > 0 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className={`${MENU_ITEM} [&>svg:last-child]:size-3.5`}>
            <Columns2Icon strokeWidth={1.75} />
            Open in split view with
          </ContextMenuSubTrigger>
          {/* Portaled: inside the scrollable menu a submenu would be clipped. */}
          <ContextMenuPortal>
            <ContextMenuSubContent className={`${MENU_SURFACE} max-w-72 min-w-52`}>
              {others.map((other) => (
                <ContextMenuItem key={other.id} className={MENU_ITEM} onSelect={() => settle(vela().split.create([tab.id, other.id], tab.id))}>
                  <Favicon src={other.favicon} url={other.url} title={other.title} asleep={other.asleep} />
                  <span className="truncate">{other.title || other.url || 'New Tab'}</span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuPortal>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator className={MENU_SEPARATOR} />
    </>
  );
}
