import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, Reorder, motion, useReducedMotion } from 'motion/react';
import { PlusIcon } from 'lucide-react';
import type { TabState } from '@shared/types';
import { useBrowserSlice, useSpaceGroups, useSpaceTabs } from '@/hooks/browser';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SPACE_HEX, settle, vela } from '@/lib/vela';
import { ui, useChromeUI } from '../ui-store';
import { TabItem } from './TabItem';
import { useScrollFade } from './use-scroll-fade';
import { computeTabWidths } from './tab-widths';
import { GroupChip, chipWidth } from './groups/GroupChip';
import { useEditingGroup } from './groups/group-ui';
import type { TabUnit, Unit } from './groups/units';
import { useUnitDrag } from './groups/use-unit-drag';

const CHIP_GAP = 4;
const noop = (): void => {};

async function newTab(): Promise<void> {
  await vela().tabs.create({ active: true });
  ui.openPalette('current');
}

/** Keep a local order while dragging; fall back to main's order otherwise. */
function applyOrder(ids: number[], byId: Map<number, TabState>): TabState[] {
  const out: TabState[] = [];
  for (const id of ids) {
    const tab = byId.get(id);
    if (tab) out.push(tab);
  }
  for (const tab of byId.values()) if (!ids.includes(tab.id)) out.push(tab);
  return out;
}

/**
 * Horizontal tab strip for the active space. Pinned group (icon-only) → separator → tabs and group
 * chips → "+". The active tab renders as the omnibox pill and shares `layoutId="omnibox"` with the
 * command palette. Grouped tabs carry an underline in their group's color that starts at the chip.
 */
export function TabStrip() {
  const tabs = useSpaceTabs();
  const groups = useSpaceGroups();
  const editingGroup = useEditingGroup();
  const activeTabId = useBrowserSlice((s) => s.activeTabId);
  const activeSpaceId = useBrowserSlice((s) => s.activeSpaceId);
  const paletteOpen = useChromeUI().palette.open;
  const reduced = !!useReducedMotion();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const fade = useScrollFade(scrollerRef);
  const frameRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = (): void => setAvailable(Math.floor(frame.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [pinnedOrder, setPinnedOrder] = useState<number[] | null>(null);
  const pinnedDragging = useRef(false);

  const { pinned, restTabs } = useMemo(() => {
    const byPinned = new Map<number, TabState>();
    const restTabs: TabState[] = [];
    for (const tab of tabs) {
      if (tab.pinned) byPinned.set(tab.id, tab);
      else restTabs.push(tab);
    }
    return { pinned: pinnedOrder ? applyOrder(pinnedOrder, byPinned) : [...byPinned.values()], restTabs };
  }, [tabs, pinnedOrder]);

  const drag = useUnitDrag(restTabs, groups, activeTabId, activeSpaceId);
  const units = drag.units;
  const rest = useMemo(() => units.flatMap((unit) => (unit.kind === 'tab' ? [unit.tab] : [])), [units]);

  useEffect(() => {
    if (!pinnedDragging.current) setPinnedOrder(null);
  }, [tabs, activeSpaceId]);

  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  const onHover = useCallback((id: number | null) => setHoveredId(id), []);
  const { onTabDragStart, onTabDragEnd, onGroupDragStart: foldGroup } = drag;
  const onDragStart = useCallback(
    (id: number) => {
      setHoveredId(null);
      if (pinnedRef.current.some((t) => t.id === id)) pinnedDragging.current = true;
      else onTabDragStart(id);
    },
    [onTabDragStart],
  );
  const onDragEnd = useCallback(
    (id: number) => {
      const pinnedIndex = pinnedRef.current.findIndex((t) => t.id === id);
      if (pinnedIndex < 0) {
        onTabDragEnd(id);
        return;
      }
      void vela()
        .tabs.move(id, pinnedIndex)
        .catch(noop)
        .finally(() =>
          window.setTimeout(() => {
            pinnedDragging.current = false;
            setPinnedOrder(null);
          }, 160),
        );
    },
    [onTabDragEnd],
  );
  const onGroupDragStart = useCallback(
    (groupId: string) => {
      setHoveredId(null);
      foldGroup(groupId);
    },
    [foldGroup],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || activeTabId == null) return;
    const frame = requestAnimationFrame(() => {
      const el = scroller.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
      el?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTabId, activeSpaceId, reduced]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent): void => {
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      scroller.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const all = Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const current = all.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
    all[next]?.focus();
  };

  const widths = useMemo(() => {
    if (available === null) return null;
    const activeInSpace = tabs.some((t) => t.id === activeTabId);
    const pinnedInactive = pinned.filter((t) => t.id !== activeTabId).length;
    const inactive = rest.filter((t) => t.id !== activeTabId).length;
    const reserved = units.reduce(
      (sum, unit) => (unit.kind === 'group' ? sum + chipWidth(unit.group, unit.group.id === editingGroup) + CHIP_GAP : sum),
      0,
    );
    return computeTabWidths({
      available,
      pinnedInactive,
      inactive,
      hasActive: activeInSpace,
      separator: pinned.length > 0 && units.length > 0,
      reserved,
    });
  }, [available, tabs, pinned, rest, units, activeTabId, editingGroup]);

  const renderItem = (tab: TabState, unit?: TabUnit) => (
    <TabItem
      width={widths ? (tab.id === activeTabId ? widths.omnibox : widths.pill) : undefined}
      compact={widths?.iconOnly ?? false}
      key={tab.id}
      tab={tab}
      active={tab.id === activeTabId}
      hovered={hoveredId === tab.id && tab.id !== activeTabId}
      paletteOpen={paletteOpen}
      onHover={onHover}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      groupColor={unit?.group ? SPACE_HEX[unit.group.color] : undefined}
      groupEnd={unit?.lastInGroup ?? false}
    />
  );

  const renderUnit = (unit: Unit, index: number) => {
    if (unit.kind === 'tab') return renderItem(unit.tab, unit);
    const next = units[index + 1];
    return (
      <GroupChip
        key={unit.key}
        group={unit.group}
        count={unit.count}
        linked={next?.kind === 'tab' && next.group?.id === unit.group.id}
        editing={editingGroup === unit.group.id}
        onDragStart={onGroupDragStart}
        onDragEnd={drag.onGroupDragEnd}
      />
    );
  };

  const layoutTransition = reduced ? { duration: 0 } : spring.snappy;

  return (
    <div ref={frameRef} className="flex h-full min-w-0 flex-1 items-center">
      <motion.div
        ref={scrollerRef}
        layoutScroll
        role="tablist"
        aria-label="Tabs"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        onPointerLeave={() => setHoveredId(null)}
        className={cn(
          'flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
        style={{
          maskImage: `linear-gradient(to right, transparent 0, #000 ${fade.left ? 24 : 0}px, #000 calc(100% - ${fade.right ? 24 : 0}px), transparent 100%)`,
        }}
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={activeSpaceId}
            className="relative flex h-full min-w-0 flex-1 items-center gap-1"
            initial={reduced ? false : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: -12, transition: { duration: 0.12 } }}
            transition={reduced ? { duration: 0 } : spring.soft}
          >
            {pinned.length > 0 && (
              <Reorder.Group as="div" axis="x" values={pinned.map((t) => t.id)} onReorder={setPinnedOrder} className="contents" role="presentation">
                <AnimatePresence initial={false} mode="popLayout">
                  {pinned.map((tab) => renderItem(tab))}
                </AnimatePresence>
              </Reorder.Group>
            )}
            <AnimatePresence initial={false}>
              {pinned.length > 0 && units.length > 0 && (
                <motion.span
                  key="pinned-separator"
                  layout="position"
                  aria-hidden="true"
                  className="mx-1 h-4 w-px shrink-0 rounded-full bg-white/10 light:bg-black/10"
                  initial={{ opacity: 0, scaleY: 0.4 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  exit={{ opacity: 0, scaleY: 0.4 }}
                  transition={layoutTransition}
                />
              )}
            </AnimatePresence>
            <Reorder.Group as="div" axis="x" values={units.map((unit) => unit.key)} onReorder={drag.onReorder} className="contents" role="presentation">
              <AnimatePresence initial={false} mode="popLayout">
                {units.map(renderUnit)}
              </AnimatePresence>
            </Reorder.Group>
            <motion.button
              type="button"
              layout="position"
              transition={layoutTransition}
              aria-label="New tab"
              title="New tab"
              onClick={() => settle(newTab())}
              className="no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-zinc-400 outline-none transition-colors duration-150 hover:bg-accent hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] active:scale-[0.96] light:text-zinc-500 light:hover:text-zinc-900"
            >
              <PlusIcon className="size-4" strokeWidth={1.75} />
            </motion.button>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
