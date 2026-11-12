import { useEffect, useState } from 'react';
import { ExternalLinkIcon, PencilIcon, PlusIcon, RotateCwIcon, SmartphoneIcon, Trash2Icon, Volume2Icon, VolumeXIcon } from 'lucide-react';
import type { PanelInfo, PanelInput } from '@shared/panels';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useOverlay, useOverlayPresence } from '@/hooks/overlay';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { IslandTooltip } from '../island/IslandTooltip';
import { MENU_ITEM, MENU_SEPARATOR, MENU_SURFACE } from '../tabs/menu-style';
import { PanelEditor } from './PanelEditor';
import { PanelSlot } from './PanelSlot';
import { applyPanelsState, usePanels } from './panel-store';

const POPOVER =
  'w-80 overflow-hidden rounded-2xl border-0 bg-popover p-0 shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_24px_64px_-12px_rgb(0_0_0/0.55)] backdrop-blur-2xl backdrop-saturate-150';

function hueOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

function PanelIcon({ panel }: { panel: PanelInfo }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (panel.favicon && failed !== panel.favicon) {
    return <img src={panel.favicon} alt="" draggable={false} className="size-[18px] rounded-[4px] object-contain" onError={() => setFailed(panel.favicon)} />;
  }
  return (
    <span
      className="inline-flex size-[18px] items-center justify-center rounded-[5px] bg-[hsl(var(--tile-hue)_70%_60%/0.2)] text-[10px] font-semibold text-[hsl(var(--tile-hue)_75%_72%)] light:bg-[hsl(var(--tile-hue)_70%_50%/0.14)] light:text-[hsl(var(--tile-hue)_60%_36%)]"
      style={{ ['--tile-hue' as string]: hueOf(panel.url) }}
    >
      {(panel.name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="pointer-events-none absolute -top-1 -right-1 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-space px-1 text-[9.5px] leading-none font-semibold text-black tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function RailButton({ panel, open, editing, onEdit }: { panel: PanelInfo; open: boolean; editing: boolean; onEdit: (id: string | null) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  useOverlayPresence(menuOpen);
  useOverlay(editing);
  const save = (input: PanelInput): Promise<unknown> =>
    vela()
      .panels.update(panel.id, { name: input.name, url: input.url, mobile: input.mobile })
      .then((next) => {
        applyPanelsState(next);
        onEdit(null);
      });
  const label = panel.badge > 0 ? `${panel.name} (${panel.badge})` : panel.name;

  return (
    <Popover open={editing} onOpenChange={(next) => onEdit(next ? panel.id : null)}>
      <ContextMenu onOpenChange={setMenuOpen} modal={false}>
        <ContextMenuTrigger asChild>
          <PopoverAnchor asChild>
            <button
              type="button"
              aria-label={label}
              aria-pressed={open}
              title={label}
              onClick={() => settle(vela().panels.toggle(panel.id))}
              className={cn(
                'no-drag relative grid size-9 shrink-0 place-items-center rounded-[10px] outline-none',
                'transition-[background-color,transform,box-shadow] duration-150 ease-out hover:bg-white/[0.07] light:hover:bg-black/[0.06]',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] active:scale-[0.96]',
                open &&
                  'bg-white/[0.08] shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-space)_40%,transparent)] light:bg-black/[0.05]',
              )}
            >
              <span className={cn('inline-flex transition-[filter,opacity] duration-200', !panel.loaded && !open && 'opacity-70', panel.frozen && 'saturate-[0.3]')}>
                <PanelIcon panel={panel} />
              </span>
              <Badge count={panel.badge} />
              {(panel.audible || panel.muted) && <span className="absolute right-1 bottom-1 size-1.5 rounded-full bg-space" aria-hidden="true" />}
            </button>
          </PopoverAnchor>
        </ContextMenuTrigger>
        <ContextMenuContent className={MENU_SURFACE} onCloseAutoFocus={(event) => event.preventDefault()}>
          <ContextMenuItem className={MENU_ITEM} onSelect={() => settle(vela().panels.reload(panel.id))}>
            <RotateCwIcon strokeWidth={1.75} />
            Reload
          </ContextMenuItem>
          <ContextMenuItem className={MENU_ITEM} onSelect={() => settle(vela().panels.toggleMute(panel.id))}>
            {panel.muted ? <Volume2Icon strokeWidth={1.75} /> : <VolumeXIcon strokeWidth={1.75} />}
            {panel.muted ? 'Unmute' : 'Mute'}
          </ContextMenuItem>
          <ContextMenuItem className={MENU_ITEM} onSelect={() => settle(vela().panels.update(panel.id, { mobile: !panel.mobile }).then(applyPanelsState))}>
            <SmartphoneIcon strokeWidth={1.75} />
            {panel.mobile ? 'Use desktop layout' : 'Use mobile layout'}
          </ContextMenuItem>
          <ContextMenuItem className={MENU_ITEM} onSelect={() => window.setTimeout(() => onEdit(panel.id), 0)}>
            <PencilIcon strokeWidth={1.75} />
            Change URL…
          </ContextMenuItem>
          <ContextMenuItem className={MENU_ITEM} onSelect={() => settle(vela().panels.openAsTab(panel.id))}>
            <ExternalLinkIcon strokeWidth={1.75} />
            Open as tab
          </ContextMenuItem>
          <ContextMenuSeparator className={MENU_SEPARATOR} />
          <ContextMenuItem className={MENU_ITEM} variant="destructive" onSelect={() => settle(vela().panels.remove(panel.id).then(applyPanelsState))}>
            <Trash2Icon strokeWidth={1.75} />
            Remove panel
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent side="left" align="start" sideOffset={10} collisionPadding={8} className={POPOVER}>
        <PanelEditor panel={panel} onSubmit={save} onCancel={() => onEdit(null)} />
      </PopoverContent>
    </Popover>
  );
}

function AddButton() {
  const [open, setOpen] = useState(false);
  useOverlay(open);
  const add = (input: PanelInput): Promise<unknown> =>
    vela()
      .panels.add(input)
      .then((next) => {
        applyPanelsState(next);
        setOpen(false);
      });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <IslandTooltip label="Add web panel">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Add web panel"
            className="no-drag grid size-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground active:scale-[0.96]"
          >
            <PlusIcon size={16} strokeWidth={1.75} />
          </button>
        </PopoverTrigger>
      </IslandTooltip>
      <PopoverContent side="left" align="start" sideOffset={10} collisionPadding={8} className={POPOVER}>
        <PanelEditor onSubmit={add} onCancel={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Web panel rail: a slim island on the right edge with pinned web apps, plus the slot of the open
 * panel between the page viewport and the rail. Only mounted while "Show panel rail" is on.
 */
export function PanelRail() {
  const { panels, openId } = usePanels();
  const [editingId, setEditingId] = useState<string | null>(null);
  const openPanel = panels.find((panel) => panel.id === openId);

  useEffect(() => () => settle(vela().panels.collapse()), []);

  return (
    <>
      {openPanel && <PanelSlot key={openPanel.id} panel={openPanel} />}
      <aside aria-label="Web panels" className="island drag flex w-12 shrink-0 flex-col items-center gap-1.5 overflow-hidden rounded-xl py-2">
        {panels.map((panel) => (
          <RailButton key={panel.id} panel={panel} open={panel.id === openId} editing={editingId === panel.id} onEdit={setEditingId} />
        ))}
        <AddButton />
      </aside>
    </>
  );
}
