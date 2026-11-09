import { memo, useRef, type CSSProperties, type MouseEvent } from 'react';
import { AnimatePresence, Reorder, motion, useReducedMotion, type Transition } from 'motion/react';
import { ChevronDownIcon, EllipsisIcon, PlusIcon } from 'lucide-react';
import type { TabGroup } from '@shared/types';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SPACE_HEX, settle, vela } from '@/lib/vela';
import { GroupContextMenu } from '../tabs/groups/GroupContextMenu';
import { GroupNameInput } from '../tabs/groups/GroupNameInput';
import { GROUP_FILL, GROUP_TEXT, groupStyle } from '../tabs/groups/group-ui';
import { groupKey } from '../tabs/groups/units';

const INSTANT: Transition = { duration: 0 };
const HEADER_HEIGHT = 30;

interface VerticalGroupHeaderProps {
  group: TabGroup;
  count: number;
  iconOnly: boolean;
  editing: boolean;
  onDragStart: (groupId: string) => void;
  onDragEnd: (groupId: string) => void;
}

/** Open the group's context menu from a button (Radix context menus only listen to `contextmenu`). */
function openMenu(event: MouseEvent<HTMLButtonElement>): void {
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left, clientY: rect.bottom + 4 }),
  );
}

const ghost =
  'no-drag inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-accent hover:text-foreground group-hover/header:opacity-100 focus-visible:opacity-100 active:scale-[0.92]';

/**
 * Collapsible section header of a group in the vertical list. Click toggles collapse; drag moves the
 * group (its tabs fold into the header while dragging); hover reveals "new tab in group" and the menu.
 */
function VerticalGroupHeaderImpl({ group, count, iconOnly, editing, onDragStart, onDragEnd }: VerticalGroupHeaderProps) {
  const reduced = !!useReducedMotion();
  const dragged = useRef(false);
  const color = SPACE_HEX[group.color];
  const label = group.name || 'Unnamed group';
  const toggle = (): void => settle(vela().groups.update(group.id, { collapsed: !group.collapsed }));

  return (
    <GroupContextMenu group={group} count={count}>
      <Reorder.Item
        as="div"
        value={groupKey(group.id)}
        layout="position"
        role="button"
        tabIndex={0}
        aria-expanded={!group.collapsed}
        aria-label={`${label}, ${count} ${count === 1 ? 'tab' : 'tabs'}`}
        title={iconOnly ? `${label} · ${count}` : undefined}
        style={groupStyle(group.color) as CSSProperties}
        initial={reduced ? false : { opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: HEADER_HEIGHT }}
        exit={reduced ? { opacity: 0, transition: INSTANT } : { opacity: 0, height: 0, transition: { ...spring.snappy, opacity: { duration: 0.1 } } }}
        transition={reduced ? INSTANT : spring.snappy}
        whileDrag={{ scale: reduced ? 1 : 1.02, zIndex: 20 }}
        dragElastic={0.06}
        onDragStart={() => {
          dragged.current = true;
          onDragStart(group.id);
        }}
        onDragEnd={() => onDragEnd(group.id)}
        onPointerDown={() => {
          dragged.current = false;
        }}
        onClick={() => {
          if (!dragged.current && !editing) toggle();
        }}
        onKeyDown={(event) => {
          if (editing || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          toggle();
        }}
        className={cn(
          'group/header no-drag relative flex shrink-0 cursor-default items-center rounded-[10px] outline-none select-none',
          'transition-colors duration-150 hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
          iconOnly ? 'justify-center' : 'gap-1.5 pr-1 pl-2',
        )}
      >
        {iconOnly ? (
          <span className={cn('relative flex h-5 min-w-5 items-center justify-center rounded-full px-1', GROUP_FILL, GROUP_TEXT)}>
            {group.collapsed ? (
              <span className="text-[10.5px] leading-none font-semibold tabular-nums">{count}</span>
            ) : (
              <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
            )}
          </span>
        ) : (
          <>
            <motion.span
              aria-hidden="true"
              className="grid size-4 shrink-0 place-items-center text-muted-foreground"
              initial={false}
              animate={{ rotate: group.collapsed ? -90 : 0 }}
              transition={reduced ? INSTANT : spring.snappy}
            >
              <ChevronDownIcon className="size-3.5" strokeWidth={2} />
            </motion.span>
            <span className={cn('flex h-5 min-w-0 items-center gap-1.5 rounded-md px-1.5', GROUP_FILL, GROUP_TEXT)}>
              {!group.name && !editing && (
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}80` }} />
              )}
              {editing ? (
                <GroupNameInput group={group} className="w-36" />
              ) : (
                group.name && <span className="min-w-0 truncate text-[12px] leading-none font-medium tracking-tight">{group.name}</span>
              )}
            </span>
            <AnimatePresence initial={false}>
              {group.collapsed && (
                <motion.span
                  key="count"
                  className="shrink-0 text-[11px] leading-none text-muted-foreground tabular-nums"
                  initial={reduced ? false : { opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -4 }}
                  transition={reduced ? INSTANT : spring.snappy}
                >
                  {count}
                </motion.span>
              )}
            </AnimatePresence>
            <span className="flex-1" />
            <button
              type="button"
              tabIndex={-1}
              aria-label="New tab in group"
              className={ghost}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                settle(vela().groups.newTab(group.id));
              }}
            >
              <PlusIcon className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Group options"
              className={ghost}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={openMenu}
            >
              <EllipsisIcon className="size-3.5" strokeWidth={1.75} />
            </button>
          </>
        )}
      </Reorder.Item>
    </GroupContextMenu>
  );
}

export const VerticalGroupHeader = memo(VerticalGroupHeaderImpl);
