import { memo, useRef, type MouseEvent } from 'react';
import { Reorder, motion, useReducedMotion, type Transition } from 'motion/react';
import { XIcon } from 'lucide-react';
import type { SplitId, TabState } from '@shared/types';
import { cn } from '@/lib/utils';
import { spring } from '@/lib/motion';
import { addressSeed, settle, vela } from '@/lib/vela';
import { ui } from '../ui-store';
import { Favicon } from './Favicon';
import { LoadingBar, OMNIBOX_SURFACE, OmniboxContent, PILL_MAX, PILL_MIN } from './TabItem';
import { TabContextMenu } from './TabContextMenu';
import type { SplitUnit } from './groups/units';

const INSTANT: Transition = { duration: 0 };

export interface SplitTabItemProps {
  unit: SplitUnit;
  activeTabId: number | null;
  paletteOpen: boolean;
  /** Widths from the strip's layout pass: each pane counts like one tab. */
  omniboxWidth?: number;
  pillWidth?: number;
  compact: boolean;
  onDragStart: (splitId: SplitId) => void;
  onDragEnd: (splitId: SplitId) => void;
  groupColor?: string;
  groupEnd?: boolean;
}

/**
 * A split view in the horizontal strip: its panes joined into one capsule, each pane a segment. When
 * the split is on screen the focused pane is the omnibox; clicking another segment focuses that pane
 * (or restores the split when it is in the background). Drags move the whole split.
 */
function SplitTabItemImpl({ unit, activeTabId, paletteOpen, omniboxWidth, pillWidth, compact, onDragStart, onDragEnd, groupColor, groupEnd = false }: SplitTabItemProps) {
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
      {unit.tabs.map((tab, index) =>
        tab.id === activeTabId ? (
          <OmniSegment key={tab.id} tab={tab} width={omniboxWidth} paletteOpen={paletteOpen} reduced={reduced} dragged={dragged} />
        ) : (
          <PaneSegment key={tab.id} tab={tab} width={pillWidth} compact={compact} first={index === 0} reduced={reduced} dragged={dragged} />
        ),
      )}
    </Reorder.Item>
  );
}

interface SegmentProps {
  tab: TabState;
  width?: number;
  reduced: boolean;
  dragged: { current: boolean };
}

/** The focused pane of the split on screen: the omnibox (shares `layoutId="omnibox"` with the palette). */
function OmniSegment({ tab, width, paletteOpen, reduced, dragged }: SegmentProps & { paletteOpen: boolean }) {
  return (
    <TabContextMenu tab={tab}>
      <motion.div
        role="tab"
        aria-selected={true}
        aria-label={tab.title || tab.url || 'New Tab'}
        tabIndex={0}
        data-tab-id={tab.id}
        data-omnibox=""
        className="relative flex h-8 min-w-0 cursor-default items-center rounded-[10px] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
        initial={false}
        animate={{ width: width ?? 'auto' }}
        transition={reduced ? INSTANT : spring.snappy}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          ui.openPalette('current', addressSeed(tab.url));
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          ui.openPalette('current', addressSeed(tab.url));
        }}
      >
        {paletteOpen ? (
          <span className="absolute inset-0 rounded-[10px] bg-white/[0.03] ring-1 ring-white/[0.06] light:bg-black/[0.03] light:ring-black/[0.05]" />
        ) : (
          <motion.span layoutId="omnibox" transition={reduced ? INSTANT : spring.snappy} style={{ borderRadius: 10 }} className={OMNIBOX_SURFACE} />
        )}
        <OmniboxContent tab={tab} reduced={reduced} paletteOpen={paletteOpen} />
        <LoadingBar show={tab.loading} reduced={reduced} />
      </motion.div>
    </TabContextMenu>
  );
}

/** Any other pane: favicon + title, hairline to its left; a press focuses it (restoring the split). */
function PaneSegment({ tab, width, compact, first, reduced, dragged }: SegmentProps & { compact: boolean; first: boolean }) {
  const label = tab.title || tab.url || 'New Tab';
  const target = compact ? PILL_MIN : width;

  const onAuxClick = (event: MouseEvent): void => {
    if (event.button !== 1) return;
    event.preventDefault();
    settle(vela().tabs.close(tab.id));
  };

  return (
    <TabContextMenu tab={tab}>
      <motion.div
        role="tab"
        aria-selected={false}
        aria-label={label}
        tabIndex={-1}
        title={label}
        data-tab-id={tab.id}
        className={cn(
          'group/seg relative flex h-8 min-w-0 cursor-default items-center rounded-[10px] outline-none transition-colors duration-150 hover:bg-accent',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
          !first && 'before:pointer-events-none before:absolute before:top-1/2 before:-left-[2.5px] before:h-3.5 before:w-px before:-translate-y-1/2 before:bg-white/10 light:before:bg-black/10',
        )}
        initial={false}
        animate={target === undefined ? { width: 'auto', minWidth: PILL_MIN, maxWidth: PILL_MAX } : { width: target, minWidth: 0, maxWidth: 'none' }}
        transition={reduced ? INSTANT : spring.snappy}
        onPointerDown={(event) => {
          if (event.button === 0) settle(vela().tabs.activate(tab.id));
        }}
        onMouseDown={(event) => event.button === 1 && event.preventDefault()}
        onAuxClick={onAuxClick}
        onClick={() => {
          dragged.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          settle(vela().tabs.activate(tab.id));
        }}
      >
        <span className={cn('relative z-10 flex min-w-0 flex-1 items-center gap-2', compact ? 'justify-center' : 'pr-1 pl-2.5')}>
          <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
            <Favicon src={tab.favicon} url={tab.url} title={tab.title} asleep={tab.asleep} />
            {tab.loading && (
              <span className="absolute -inset-1 animate-spin rounded-full border-[1.5px] border-transparent border-t-space [animation-duration:0.8s]" />
            )}
          </span>
          {!compact && (
            <>
              <span
                className={cn(
                  'min-w-0 flex-1 overflow-hidden py-1 text-[12.5px] leading-none tracking-tight whitespace-nowrap text-zinc-400 transition-colors duration-150',
                  '[mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)] group-hover/seg:[mask-image:linear-gradient(to_right,#000_calc(100%-36px),transparent_calc(100%-20px))]',
                  'group-hover/seg:text-zinc-100 light:text-zinc-600 light:group-hover/seg:text-zinc-900',
                  tab.asleep && 'text-zinc-500 light:text-zinc-500',
                )}
              >
                {tab.title || 'New Tab'}
              </span>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Close tab"
                className={cn(
                  'absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-[opacity,background-color,color] duration-150',
                  'group-hover/seg:opacity-100 hover:bg-white/10 hover:text-zinc-100 active:scale-[0.92]',
                  'light:text-zinc-500 light:hover:bg-black/[0.07] light:hover:text-zinc-900',
                )}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  settle(vela().tabs.close(tab.id));
                }}
              >
                <XIcon className="size-3.5" strokeWidth={2} />
              </button>
            </>
          )}
        </span>
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
      !x.devices === !y.devices &&
      x.blockedCount === y.blockedCount &&
      x.secure === y.secure &&
      x.groupId === y.groupId)
  );
}

function same(a: SplitTabItemProps, b: SplitTabItemProps): boolean {
  if (a.activeTabId !== b.activeTabId || a.paletteOpen !== b.paletteOpen || a.compact !== b.compact) return false;
  if (a.omniboxWidth !== b.omniboxWidth || a.pillWidth !== b.pillWidth || a.groupColor !== b.groupColor || a.groupEnd !== b.groupEnd) return false;
  if (a.onDragStart !== b.onDragStart || a.onDragEnd !== b.onDragEnd || a.unit.key !== b.unit.key) return false;
  const x = a.unit.tabs;
  const y = b.unit.tabs;
  return x.length === y.length && x.every((tab, i) => sameTab(tab, y[i]!));
}

export const SplitTabItem = memo(SplitTabItemImpl, same);
