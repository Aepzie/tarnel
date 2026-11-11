import { memo, useRef, type MouseEvent } from 'react';
import { Reorder, motion, useReducedMotion, type Transition } from 'motion/react';
import type { SplitId, TabState } from '@shared/types';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { Favicon } from '../tabs/Favicon';
import { TabContextMenu } from '../tabs/TabContextMenu';
import type { SplitUnit } from '../tabs/groups/units';
import { ACTIVE_ROW, ROW_HEIGHT } from './VerticalTabRow';
import { TabFlag, withVpnLabel } from '../vpn/TabFlag';

const INSTANT: Transition = { duration: 0 };

interface VerticalSplitRowProps {
  unit: SplitUnit;
  activeTabId: number | null;
  iconOnly: boolean;
  groupColor?: string;
  groupEnd?: boolean;
  onDragStart: (splitId: SplitId) => void;
  onDragEnd: (splitId: SplitId) => void;
}

/**
 * A split view in the vertical list: one row, one segment per pane (hairline between them). The
 * focused pane of the split on screen carries the gliding active highlight; a press on any segment
 * focuses that pane, restoring the split when it is in the background. Drags move the whole split.
 */
function VerticalSplitRowImpl({ unit, activeTabId, iconOnly, groupColor, groupEnd = false, onDragStart, onDragEnd }: VerticalSplitRowProps) {
  const reduced = !!useReducedMotion();
  const dragged = useRef(false);
  const onScreen = activeTabId !== null && unit.split.tabIds.includes(activeTabId);
  const label = unit.tabs.map((tab) => tab.title || 'New Tab').join(' · ');
  // With 3–4 panes only one segment keeps its title (the focused one, else the first); the others shrink to favicons.
  const crowded = unit.tabs.length > 2;
  const titled = onScreen ? activeTabId : unit.tabs[0]?.id;

  return (
    <Reorder.Item
      as="div"
      value={unit.key}
      layout="position"
      role="group"
      aria-label={`Split view: ${label}`}
      title={iconOnly ? label : undefined}
      data-split-id={unit.split.id}
      initial={reduced ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: ROW_HEIGHT }}
      exit={reduced ? { opacity: 0, transition: INSTANT } : { opacity: 0, height: 0, transition: { ...spring.snappy, opacity: { duration: 0.1 } } }}
      transition={reduced ? INSTANT : spring.snappy}
      whileDrag={{ scale: reduced ? 1 : 1.02, zIndex: 20 }}
      dragElastic={0.06}
      onPointerDown={() => {
        dragged.current = false;
      }}
      onDragStart={() => {
        dragged.current = true;
        onDragStart(unit.split.id);
      }}
      onDragEnd={() => onDragEnd(unit.split.id)}
      className={cn('no-drag relative flex shrink-0 items-stretch rounded-[10px]', iconOnly ? 'gap-0' : 'gap-px')}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-[10px] ring-1 ring-inset transition-colors duration-150',
          onScreen ? 'bg-white/[0.03] ring-white/[0.07] light:bg-black/[0.025] light:ring-black/[0.06]' : 'bg-white/[0.02] ring-white/[0.05] light:bg-black/[0.02] light:ring-black/[0.05]',
        )}
      />
      {groupColor && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute w-[2px] rounded-full opacity-70',
            iconOnly ? 'left-0.5' : 'left-[15px]',
            groupEnd ? 'top-0 bottom-1.5' : '-top-px -bottom-px',
          )}
          style={{ backgroundColor: groupColor }}
        />
      )}
      {/* The icon rail only has room for two favicons. */}
      {(iconOnly ? unit.tabs.slice(0, 2) : unit.tabs).map((tab, index) => (
        <Segment
          key={tab.id}
          tab={tab}
          focused={tab.id === activeTabId}
          first={index === 0}
          iconOnly={iconOnly}
          compact={!iconOnly && crowded && tab.id !== titled}
          grouped={!!groupColor && index === 0}
          reduced={reduced}
        />
      ))}
    </Reorder.Item>
  );
}

interface SegmentProps {
  tab: TabState;
  focused: boolean;
  first: boolean;
  iconOnly: boolean;
  /** Favicon-only segment of a crowded (3–4 pane) split. */
  compact: boolean;
  grouped: boolean;
  reduced: boolean;
}

function Segment({ tab, focused, first, iconOnly, compact, grouped, reduced }: SegmentProps) {
  const label = tab.title || tab.url || 'New Tab';

  const onAuxClick = (event: MouseEvent): void => {
    if (event.button !== 1) return;
    event.preventDefault();
    settle(vela().tabs.close(tab.id));
  };

  return (
    <TabContextMenu tab={tab}>
      <div
        role="tab"
        aria-selected={focused}
        aria-label={label}
        tabIndex={focused ? 0 : -1}
        title={iconOnly ? undefined : withVpnLabel(label, tab)}
        data-tab-id={tab.id}
        style={compact ? { flex: '0 0 auto' } : undefined}
        onPointerDown={(event) => {
          if (event.button === 0 && !focused) settle(vela().tabs.activate(tab.id));
        }}
        onMouseDown={(event) => event.button === 1 && event.preventDefault()}
        onAuxClick={onAuxClick}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (!focused) settle(vela().tabs.activate(tab.id));
        }}
        className={cn(
          'group/seg relative flex min-w-0 flex-1 cursor-default items-center rounded-[10px] outline-none select-none',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
          !focused && 'transition-colors duration-150 hover:bg-accent',
          !first && 'before:pointer-events-none before:absolute before:top-1/2 before:-left-px before:h-3.5 before:w-px before:-translate-y-1/2 before:bg-white/10 light:before:bg-black/10',
        )}
      >
        {focused && <motion.span data-slot="glass-control-highlight" layoutId="vertical-active-tab" className={ACTIVE_ROW} transition={reduced ? INSTANT : spring.snappy} />}
        <TabFlag tab={tab} />
        <span
          className={cn(
            'relative z-10 flex h-full min-w-0 flex-1 items-center gap-2',
            iconOnly ? 'justify-center' : compact ? (grouped ? 'w-[52px] justify-end pr-2' : 'w-8 justify-center') : grouped ? 'pr-1.5 pl-7' : 'pr-1.5 pl-2.5',
          )}
        >
          <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
            <Favicon src={tab.favicon} url={tab.url} title={tab.title} asleep={tab.asleep} />
            {tab.loading && (
              <span className="absolute -inset-1 animate-spin rounded-full border-[1.5px] border-transparent border-t-space [animation-duration:0.8s]" />
            )}
          </span>
          {!iconOnly && !compact && (
            <span
              className={cn(
                'min-w-0 flex-1 overflow-hidden text-[13px] leading-none tracking-tight whitespace-nowrap transition-colors duration-150',
                '[mask-image:linear-gradient(to_right,#000_calc(100%-12px),transparent)]',
                focused ? 'text-zinc-100 light:text-zinc-900' : 'text-zinc-400 group-hover/seg:text-zinc-100 light:text-zinc-600 light:group-hover/seg:text-zinc-900',
                tab.asleep && !focused && 'text-zinc-500 light:text-zinc-500',
              )}
            >
              {tab.title || 'New Tab'}
            </span>
          )}
        </span>
      </div>
    </TabContextMenu>
  );
}

function sameTab(x: TabState, y: TabState): boolean {
  return (
    x === y ||
    (x.id === y.id &&
      x.title === y.title &&
      x.url === y.url &&
      x.favicon === y.favicon &&
      x.loading === y.loading &&
      x.asleep === y.asleep &&
      x.groupId === y.groupId)
  );
}

function same(a: VerticalSplitRowProps, b: VerticalSplitRowProps): boolean {
  if (a.activeTabId !== b.activeTabId || a.iconOnly !== b.iconOnly || a.groupColor !== b.groupColor || a.groupEnd !== b.groupEnd) return false;
  if (a.onDragStart !== b.onDragStart || a.onDragEnd !== b.onDragEnd || a.unit.key !== b.unit.key) return false;
  const x = a.unit.tabs;
  const y = b.unit.tabs;
  return x.length === y.length && x.every((tab, i) => sameTab(tab, y[i]!));
}

export const VerticalSplitRow = memo(VerticalSplitRowImpl, same);
