import { memo, useRef, type MouseEvent } from 'react';
import { Reorder, motion, useReducedMotion, type Transition } from 'motion/react';
import type { SplitId, TabState } from '@shared/types';
import { cn } from '@/lib/utils';
import { spring } from '@/lib/motion';
import { addressSeed, settle, vela } from '@/lib/vela';
import { ui } from '../ui-store';
import { ActiveSurface, PILL_MAX, PILL_MIN } from './TabItem';
import { TabFace, tabTooltip } from './TabFace';
import { TabFlag } from '../vpn/TabFlag';
import { TabContextMenu } from './TabContextMenu';
import type { SplitUnit } from './groups/units';

const INSTANT: Transition = { duration: 0 };

export interface SplitTabItemProps {
  unit: SplitUnit;
  activeTabId: number | null;
  paletteOpen: boolean;
  /** Width from the strip's layout pass: each pane counts like one tab. */
  pillWidth?: number;
  compact: boolean;
  onDragStart: (splitId: SplitId) => void;
  onDragEnd: (splitId: SplitId) => void;
  groupColor?: string;
  groupEnd?: boolean;
}

/**
 * A split view in the horizontal strip: its panes joined into one capsule, each pane a segment. Every pane
 * has the strip's tab width; clicking another segment focuses that pane (or restores the split when it is
 * in the background). Drags move the whole split.
 */
function SplitTabItemImpl({ unit, activeTabId, paletteOpen, pillWidth, compact, onDragStart, onDragEnd, groupColor, groupEnd = false }: SplitTabItemProps) {
  const reduced = !!useReducedMotion();
  const dragged = useRef(false);
  const layoutTransition = reduced ? INSTANT : spring.snappy;
  const onScreen = activeTabId !== null && unit.split.tabIds.includes(activeTabId);
  const label = unit.tabs.map((tab) => tab.title || 'New Tab').join(' · ');

  return (
    <Reorder.Item
      as="div"
      value={unit.key}
      layout="position"
      role="group"
      aria-label={`Split view: ${label}`}
      data-split-id={unit.split.id}
      initial={reduced ? false : { opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0, transition: INSTANT } : { opacity: 0, scale: 0.92, transition: { ...spring.snappy, opacity: { duration: 0.12 } } }}
      transition={layoutTransition}
      whileDrag={{ scale: reduced ? 1 : 1.03, zIndex: 20 }}
      dragElastic={0.08}
      onPointerDown={() => {
        dragged.current = false;
      }}
      onDragStart={() => {
        dragged.current = true;
        onDragStart(unit.split.id);
      }}
      onDragEnd={() => onDragEnd(unit.split.id)}
      className="no-drag relative flex h-8 shrink-0 items-center gap-1 rounded-[10px]"
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-[10px] ring-1 transition-colors duration-150',
          onScreen ? 'bg-white/[0.035] ring-white/[0.08] light:bg-black/[0.03] light:ring-black/[0.07]' : 'bg-white/[0.03] ring-white/[0.06] light:bg-black/[0.025] light:ring-black/[0.06]',
        )}
      />
      {groupColor && (
        <motion.span
          aria-hidden="true"
          className={cn('pointer-events-none absolute -bottom-[3px] left-0 h-[2px]', groupEnd ? 'right-1 rounded-r-full' : '-right-1')}
          style={{ backgroundColor: groupColor, transformOrigin: 'left' }}
          initial={reduced ? false : { scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 0.75 }}
          transition={layoutTransition}
        />
      )}
      {unit.tabs.map((tab, index) => (
        <Segment
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          width={pillWidth}
          compact={compact}
          first={index === 0}
          paletteOpen={paletteOpen}
          reduced={reduced}
          dragged={dragged}
        />
      ))}
    </Reorder.Item>
  );
}

interface SegmentProps {
  tab: TabState;
  active: boolean;
  width?: number;
  compact: boolean;
  first: boolean;
  paletteOpen: boolean;
  reduced: boolean;
  dragged: { current: boolean };
}

/**
 * One pane of the split: same width as any other tab. A press focuses it (restoring the split); a click
 * on the focused pane opens the palette, whose surface morphs out of the pane's raised fill.
 */
function Segment({ tab, active, width, compact, first, paletteOpen, reduced, dragged }: SegmentProps) {
  const target = compact ? PILL_MIN : width;

  const onAuxClick = (event: MouseEvent): void => {
    if (event.button !== 1) return;
    event.preventDefault();
    settle(vela().tabs.close(tab.id));
  };

  const wasActive = useRef(false);

  const onClick = (): void => {
    const opensPalette = wasActive.current && !dragged.current;
    dragged.current = false;
    wasActive.current = false;
    if (opensPalette) ui.openPalette('current', addressSeed(tab.url));
  };

  return (
    <TabContextMenu tab={tab}>
      <motion.div
        role="tab"
        aria-selected={active}
        aria-label={tab.title || tab.url || 'New Tab'}
        tabIndex={active ? 0 : -1}
        title={tabTooltip(tab, active)}
        data-tab-id={tab.id}
        data-omnibox={active ? '' : undefined}
        className={cn(
          'group/tab relative flex h-8 min-w-0 cursor-default items-center rounded-[10px] outline-none transition-colors duration-150',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
          !active && 'hover:bg-accent',
          !first && 'before:pointer-events-none before:absolute before:top-1/2 before:-left-[2.5px] before:h-3.5 before:w-px before:-translate-y-1/2 before:bg-white/10 light:before:bg-black/10',
        )}
        initial={false}
        animate={target === undefined ? { width: 'auto', minWidth: PILL_MIN, maxWidth: PILL_MAX } : { width: target, minWidth: 0, maxWidth: 'none' }}
        transition={reduced ? INSTANT : spring.snappy}
        onPointerDown={(event) => {
          wasActive.current = event.button === 0 && active;
          if (event.button === 0 && !active) settle(vela().tabs.activate(tab.id));
        }}
        onMouseDown={(event) => event.button === 1 && event.preventDefault()}
        onAuxClick={onAuxClick}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (active) ui.openPalette('current', addressSeed(tab.url));
          else settle(vela().tabs.activate(tab.id));
        }}
      >
        {active && <ActiveSurface paletteOpen={paletteOpen} reduced={reduced} />}
        <TabFlag tab={tab} />
        <TabFace tab={tab} active={active} iconOnly={compact} />
      </motion.div>
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
      x.audible === y.audible &&
      x.muted === y.muted &&
      x.micActive === y.micActive &&
      x.vpn === y.vpn &&
      !x.devices === !y.devices &&
      x.blockedCount === y.blockedCount &&
      x.secure === y.secure &&
      x.groupId === y.groupId)
  );
}

function same(a: SplitTabItemProps, b: SplitTabItemProps): boolean {
  if (a.activeTabId !== b.activeTabId || a.paletteOpen !== b.paletteOpen || a.compact !== b.compact) return false;
  if (a.pillWidth !== b.pillWidth || a.groupColor !== b.groupColor || a.groupEnd !== b.groupEnd) return false;
  if (a.onDragStart !== b.onDragStart || a.onDragEnd !== b.onDragEnd || a.unit.key !== b.unit.key) return false;
  const x = a.unit.tabs;
  const y = b.unit.tabs;
  return x.length === y.length && x.every((tab, i) => sameTab(tab, y[i]!));
}

export const SplitTabItem = memo(SplitTabItemImpl, same);
