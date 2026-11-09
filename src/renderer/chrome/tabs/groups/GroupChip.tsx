import { memo, useRef, type CSSProperties } from 'react';
import { AnimatePresence, Reorder, motion, useReducedMotion } from 'motion/react';
import type { TabGroup } from '@shared/types';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SPACE_HEX, settle, vela } from '@/lib/vela';
import { GroupContextMenu } from './GroupContextMenu';
import { GroupNameInput } from './GroupNameInput';
import { GROUP_FILL, GROUP_TEXT, groupStyle } from './group-ui';
import { groupKey } from './units';

const INSTANT = { duration: 0 };
const CHAR_PX = 6.6;
const CHIP_PAD = 20;
const CHIP_MAX = 128;
const COUNT_PX = 16;
export const CHIP_DOT = 24;

/** Deterministic chip width so the strip's width pass can reserve it without measuring. */
export function chipWidth(group: TabGroup, editing: boolean): number {
  if (editing) return CHIP_MAX;
  if (!group.name) return group.collapsed ? CHIP_DOT + COUNT_PX : CHIP_DOT;
  const text = Math.ceil(group.name.length * CHAR_PX) + CHIP_PAD + (group.collapsed ? COUNT_PX : 0);
  return Math.min(CHIP_MAX, Math.max(CHIP_DOT, text));
}

interface GroupChipProps {
  group: TabGroup;
  count: number;
  /** Members are visible after the chip: the underline continues into them. */
  linked: boolean;
  editing: boolean;
  onDragStart: (groupId: string) => void;
  onDragEnd: (groupId: string) => void;
}

/**
 * Group label in the horizontal strip. Click toggles collapse, right-click opens the group menu,
 * dragging moves the whole group (the strip folds the members into the chip while dragging).
 */
function GroupChipImpl({ group, count, linked, editing, onDragStart, onDragEnd }: GroupChipProps) {
  const reduced = !!useReducedMotion();
  const dragged = useRef(false);
  const width = chipWidth(group, editing);
  const color = SPACE_HEX[group.color];
  const label = group.name || 'Unnamed group';

  return (
    <GroupContextMenu group={group} count={count}>
      <Reorder.Item
        as="div"
        value={groupKey(group.id)}
        layout="position"
        role="button"
        tabIndex={0}
        aria-label={`${label}, ${count} ${count === 1 ? 'tab' : 'tabs'}, ${group.collapsed ? 'collapsed' : 'expanded'}`}
        aria-expanded={!group.collapsed}
        title={group.collapsed ? `${label} · ${count}` : label}
        data-group-id={group.id}
        style={groupStyle(group.color) as CSSProperties}
        initial={reduced ? false : { opacity: 0, scale: 0.8, width: 0 }}
        animate={{ opacity: 1, scale: 1, width }}
        exit={reduced ? { opacity: 0, transition: INSTANT } : { opacity: 0, scale: 0.8, width: 0, transition: { ...spring.snappy, opacity: { duration: 0.12 } } }}
        transition={reduced ? INSTANT : spring.snappy}
        whileDrag={{ scale: reduced ? 1 : 1.06, zIndex: 20 }}
        dragElastic={0.08}
        onDragStart={() => {
          dragged.current = true;
          onDragStart(group.id);
        }}
        onDragEnd={() => onDragEnd(group.id)}
        onPointerDown={() => {
          dragged.current = false;
        }}
        onClick={() => {
          if (dragged.current || editing) return;
          settle(vela().groups.update(group.id, { collapsed: !group.collapsed }));
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (editing || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          settle(vela().groups.update(group.id, { collapsed: !group.collapsed }));
        }}
        className="no-drag relative flex h-8 shrink-0 cursor-default items-center rounded-full outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
      >
        <span
          className={cn(
            'relative flex h-6 w-full min-w-0 items-center justify-center gap-1.5 rounded-full transition-[background-color,box-shadow] duration-150',
            GROUP_FILL,
            GROUP_TEXT,
            group.name || editing ? 'px-2.5' : 'px-0',
            'hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--group)_35%,transparent)]',
          )}
        >
          {editing ? (
            <GroupNameInput group={group} className="w-full text-center" />
          ) : group.name ? (
            <span className="min-w-0 truncate text-[12px] leading-none font-medium tracking-tight">{group.name}</span>
          ) : (
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}80` }} />
          )}
          <AnimatePresence initial={false}>
            {group.collapsed && !editing && (
              <motion.span
                key="count"
                className="shrink-0 text-[10.5px] leading-none font-medium tabular-nums opacity-70"
                initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 0.7, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={reduced ? INSTANT : spring.pop}
              >
                {count}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <AnimatePresence initial={false}>
          {linked && (
            <motion.span
              key="link"
              aria-hidden="true"
              className="pointer-events-none absolute -right-1 -bottom-[3px] left-3 h-[2px] rounded-l-full"
              style={{ backgroundColor: color, transformOrigin: 'left' }}
              initial={reduced ? false : { scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 0.75 }}
              exit={{ scaleX: 0, opacity: 0 }}
              transition={reduced ? INSTANT : spring.snappy}
            />
          )}
        </AnimatePresence>
      </Reorder.Item>
    </GroupContextMenu>
  );
}

export const GroupChip = memo(GroupChipImpl);
