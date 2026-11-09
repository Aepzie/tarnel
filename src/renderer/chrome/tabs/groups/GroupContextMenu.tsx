import { useId, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronsDownUpIcon, ChevronsUpDownIcon, PencilIcon, PlusIcon, UngroupIcon, XIcon } from 'lucide-react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import { SPACE_COLORS, type TabGroup } from '@shared/types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useOverlayPresence } from '@/hooks/overlay';
import { spring } from '@/lib/motion';
import { SPACE_HEX, settle, vela } from '@/lib/vela';
import { colorLabel } from '../../spaces/ColorSwatches';
import { MENU_ITEM, MENU_SEPARATOR, MENU_SURFACE } from '../menu-style';
import { setEditingGroup } from './group-ui';

function GroupColorRow({ group }: { group: TabGroup }) {
  const ringId = useId();
  const reduce = useReducedMotion();
  return (
    <ContextMenuPrimitive.Group aria-label="Color" className="flex items-center justify-between px-1 pb-1">
      {SPACE_COLORS.map((color) => {
        const selected = color === group.color;
        return (
          <ContextMenuPrimitive.Item
            key={color}
            aria-label={colorLabel(color)}
            aria-checked={selected}
            role="menuitemradio"
            onSelect={(event) => {
              event.preventDefault();
              if (!selected) settle(vela().groups.update(group.id, { color }));
            }}
            className="relative grid size-6 cursor-default place-items-center rounded-full outline-none data-[highlighted]:bg-foreground/[0.08]"
          >
            {selected && (
              <motion.span
                layoutId={`group-swatch-${ringId}`}
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: `inset 0 0 0 1.5px ${SPACE_HEX[color]}` }}
                transition={reduce ? { duration: 0 } : spring.pop}
              />
            )}
            <motion.span
              className="size-3.5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]"
              style={{ backgroundColor: SPACE_HEX[color] }}
              initial={false}
              animate={{ scale: selected ? 0.86 : 1 }}
              transition={reduce ? { duration: 0 } : spring.pop}
            />
          </ContextMenuPrimitive.Item>
        );
      })}
    </ContextMenuPrimitive.Group>
  );
}

/** Right-click menu of a group chip / header: rename, recolor, collapse, new tab, ungroup, close. */
export function GroupContextMenu({ group, count, children }: { group: TabGroup; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useOverlayPresence(open);
  const api = vela().groups;

  return (
    <ContextMenu onOpenChange={setOpen} modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className={`${MENU_SURFACE} w-60`} onCloseAutoFocus={(event) => event.preventDefault()}>
        <ContextMenuLabel className="flex items-center gap-2 px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
          <span className="min-w-0 truncate">{group.name || 'Group'}</span>
          <span className="ml-auto tabular-nums normal-case">{count === 1 ? '1 tab' : `${count} tabs`}</span>
        </ContextMenuLabel>
        <GroupColorRow group={group} />
        <ContextMenuSeparator className={MENU_SEPARATOR} />
        <ContextMenuItem className={MENU_ITEM} onSelect={() => window.setTimeout(() => setEditingGroup(group.id), 0)}>
          <PencilIcon strokeWidth={1.75} />
          Rename…
        </ContextMenuItem>
        <ContextMenuItem className={MENU_ITEM} onSelect={() => settle(api.update(group.id, { collapsed: !group.collapsed }))}>
          {group.collapsed ? <ChevronsUpDownIcon strokeWidth={1.75} /> : <ChevronsDownUpIcon strokeWidth={1.75} />}
          {group.collapsed ? 'Expand group' : 'Collapse group'}
        </ContextMenuItem>
        <ContextMenuItem className={MENU_ITEM} onSelect={() => settle(api.newTab(group.id))}>
          <PlusIcon strokeWidth={1.75} />
          New tab in group
        </ContextMenuItem>
        <ContextMenuSeparator className={MENU_SEPARATOR} />
        <ContextMenuItem className={MENU_ITEM} onSelect={() => settle(api.ungroup(group.id))}>
          <UngroupIcon strokeWidth={1.75} />
          Ungroup
        </ContextMenuItem>
        <ContextMenuItem className={MENU_ITEM} variant="destructive" onSelect={() => settle(api.close(group.id))}>
          <XIcon strokeWidth={1.75} />
          Close group
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
