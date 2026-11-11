import { useState, type ReactNode } from 'react';
import {
  ArchiveIcon,
  CopyIcon,
  FolderInputIcon,
  LayersIcon,
  LayersMinusIcon,
  LayersPlusIcon,
  MoonIcon,
  PinIcon,
  PinOffIcon,
  RotateCwIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
  XSquareIcon,
} from 'lucide-react';
import { MENU_ITEM, MENU_SEPARATOR, MENU_SURFACE } from './menu-style';
import { groupIntoNew } from './groups/group-ui';
import { SplitMenuItems } from '../split/SplitMenuItems';
import { AudioDevicesMenu } from '../audio/AudioDevicesMenu';
import { TabVpnMenu } from '../vpn/TabVpnMenu';
import type { TabState } from '@shared/types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Kbd } from '@/components/ui/kbd';
import { getBrowserStateSnapshot, useBrowserSlice } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { SPACE_HEX, settle, vela } from '@/lib/vela';

const SURFACE = MENU_SURFACE;
const ITEM = MENU_ITEM;

function modKey(): string {
  return window.vela?.platform === 'darwin' ? '⌘' : 'Ctrl';
}

function Hint({ children }: { children: ReactNode }) {
  return <Kbd className="ml-auto h-[18px] rounded-[5px] bg-white/[0.06] px-1.5 text-[10.5px] text-zinc-400 light:bg-black/[0.05] light:text-zinc-500">{children}</Kbd>;
}

function MoveToSpace({ tab }: { tab: TabState }) {
  const spaces = useBrowserSlice((s) => s.spaces);
  const others = spaces.filter((s) => s.id !== tab.spaceId);
  if (others.length === 0) return null;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className={`${ITEM} [&>svg:last-child]:size-3.5`}>
        <FolderInputIcon strokeWidth={1.75} />
        Move to Space
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className={`${SURFACE} min-w-44`}>
        {others.map((space) => (
          <ContextMenuItem key={space.id} className={ITEM} onSelect={() => settle(vela().tabs.moveToSpace(tab.id, space.id))}>
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: SPACE_HEX[space.color], boxShadow: `0 0 8px ${SPACE_HEX[space.color]}66` }}
            />
            <span className="truncate">{space.name}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** "Add to new group" plus, when the space has other groups, an "Add to group ›" submenu. */
function GroupItems({ tab }: { tab: TabState }) {
  const groups = useBrowserSlice((s) => s.groups);
  const others = groups.filter((group) => group.spaceId === tab.spaceId && group.id !== tab.groupId);
  return (
    <>
      <ContextMenuItem className={ITEM} onSelect={() => settle(groupIntoNew([tab.id]))}>
        <LayersPlusIcon strokeWidth={1.75} />
        Add to new group
      </ContextMenuItem>
      {others.length > 0 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className={`${ITEM} [&>svg:last-child]:size-3.5`}>
            <LayersIcon strokeWidth={1.75} />
            Add to group
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className={`${SURFACE} min-w-44`}>
            {others.map((group) => (
              <ContextMenuItem key={group.id} className={ITEM} onSelect={() => settle(vela().groups.addTabs(group.id, [tab.id]))}>
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SPACE_HEX[group.color] }} />
                <span className={group.name ? 'truncate' : 'truncate text-muted-foreground'}>{group.name || 'Unnamed group'}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      {tab.groupId && (
        <ContextMenuItem className={ITEM} onSelect={() => settle(vela().groups.removeTabs([tab.id]))}>
          <LayersMinusIcon strokeWidth={1.75} />
          Remove from group
        </ContextMenuItem>
      )}
    </>
  );
}

function archiveOthers(tab: TabState): void {
  const { tabs } = getBrowserStateSnapshot();
  const ids = tabs.filter((other) => other.spaceId === tab.spaceId && other.id !== tab.id && !other.pinned).map((other) => other.id);
  if (ids.length > 0) settle(vela().tabArchive.archiveTabs(ids));
}

function closeOthers(tab: TabState): void {
  const { tabs } = getBrowserStateSnapshot();
  for (const other of tabs) {
    if (other.spaceId === tab.spaceId && other.id !== tab.id && !other.pinned) settle(vela().tabs.close(other.id));
  }
}

interface TabContextMenuProps {
  tab: TabState;
  children: ReactNode;
}

/** Per-tab context menu. Holds the page overlay while open so the menu can extend over the page. */
export function TabContextMenu({ tab, children }: TabContextMenuProps) {
  const [open, setOpen] = useState(false);
  useOverlayPresence(open);
  const mod = modKey();
  const api = vela().tabs;

  return (
    <ContextMenu onOpenChange={setOpen} modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className={SURFACE} onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem className={ITEM} onSelect={() => void api.reload(tab.id)}>
            <RotateCwIcon strokeWidth={1.75} />
            Reload
            <Hint>{mod} R</Hint>
          </ContextMenuItem>
          <ContextMenuItem className={ITEM} onSelect={() => void api.duplicate(tab.id)}>
            <CopyIcon strokeWidth={1.75} />
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem className={ITEM} onSelect={() => void api.togglePin(tab.id)}>
            {tab.pinned ? <PinOffIcon strokeWidth={1.75} /> : <PinIcon strokeWidth={1.75} />}
            {tab.pinned ? 'Unpin' : 'Pin'}
          </ContextMenuItem>
          <ContextMenuItem className={ITEM} onSelect={() => void api.toggleMute(tab.id)}>
            {tab.muted ? <Volume2Icon strokeWidth={1.75} /> : <VolumeXIcon strokeWidth={1.75} />}
            {tab.muted ? 'Unmute' : 'Mute'}
          </ContextMenuItem>
          <ContextMenuItem className={ITEM} disabled={tab.asleep} onSelect={() => void api.sleep(tab.id)}>
            <MoonIcon strokeWidth={1.75} />
            Sleep now
          </ContextMenuItem>
          <MoveToSpace tab={tab} />
          <TabVpnMenu tab={tab} />
          <AudioDevicesMenu tab={tab} />
          <ContextMenuSeparator className={MENU_SEPARATOR} />
          <GroupItems tab={tab} />
          <ContextMenuSeparator className={MENU_SEPARATOR} />
          <SplitMenuItems tab={tab} />
          <ContextMenuItem className={ITEM} disabled={tab.pinned} onSelect={() => settle(vela().tabArchive.archiveTabs([tab.id]))}>
            <ArchiveIcon strokeWidth={1.75} />
            Move to archive
            <Hint>{mod} Shift E</Hint>
          </ContextMenuItem>
          <ContextMenuItem className={ITEM} onSelect={() => archiveOthers(tab)}>
            <ArchiveIcon strokeWidth={1.75} />
            Archive other tabs
          </ContextMenuItem>
          <ContextMenuItem className={ITEM} onSelect={() => void api.close(tab.id)}>
            <XIcon strokeWidth={1.75} />
            Close tab
            <Hint>{mod} W</Hint>
          </ContextMenuItem>
          <ContextMenuItem className={ITEM} onSelect={() => closeOthers(tab)}>
            <XSquareIcon strokeWidth={1.75} />
            Close other tabs
          </ContextMenuItem>
        </ContextMenuContent>
    </ContextMenu>
  );
}
