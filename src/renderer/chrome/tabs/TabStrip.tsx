import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, Reorder, motion, useReducedMotion } from 'motion/react';
import { PlusIcon } from 'lucide-react';
import type { TabState } from '@shared/types';
import { useBrowserSlice, useSpaceTabs } from '@/hooks/browser';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { ui, useChromeUI } from '../ui-store';
import { TabItem } from './TabItem';
import { useScrollFade } from './use-scroll-fade';
import { computeTabWidths } from './tab-widths';

interface DragOrder {
  pinned: number[];
  rest: number[];
}

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
 * Horizontal tab strip for the active space. Pinned group (icon-only) → separator → tabs → "+".
 * The active tab renders as the omnibox pill and shares `layoutId="omnibox"` with the command palette.
 */
export function TabStrip() {
  const tabs = useSpaceTabs();
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
  const [dragOrder, setDragOrder] = useState<DragOrder | null>(null);
  const dragging = useRef(false);

  const { pinned, rest } = useMemo(() => {
    const byPinned = new Map<number, TabState>();
    const byRest = new Map<number, TabState>();
    for (const tab of tabs) (tab.pinned ? byPinned : byRest).set(tab.id, tab);
    if (!dragOrder) return { pinned: [...byPinned.values()], rest: [...byRest.values()] };
    return { pinned: applyOrder(dragOrder.pinned, byPinned), rest: applyOrder(dragOrder.rest, byRest) };
  }, [tabs, dragOrder]);

  useEffect(() => {
    if (dragging.current && draggedId.current !== null && !tabs.some((t) => t.id === draggedId.current)) {
      dragging.current = false;
      draggedId.current = null;
    }
    if (!dragging.current) setDragOrder(null);
  }, [tabs]);

  useEffect(() => {
    dragging.current = false;
    draggedId.current = null;
    setDragOrder(null);
  }, [activeSpaceId]);

  const orderRef = useRef({ pinned, rest });
  orderRef.current = { pinned, rest };

  const onHover = useCallback((id: number | null) => setHoveredId(id), []);
  const draggedId = useRef<number | null>(null);
  const onDragStart = useCallback((id: number) => {
    dragging.current = true;
    draggedId.current = id;
    setHoveredId(null);
  }, []);
  const onDragEnd = useCallback((id: number) => {
    dragging.current = false;
    draggedId.current = null;
    const order = orderRef.current;
    const pinnedIndex = order.pinned.findIndex((t) => t.id === id);
    const index = pinnedIndex >= 0 ? pinnedIndex : order.pinned.length + order.rest.findIndex((t) => t.id === id);
    void vela()
      .tabs.move(id, index)
      .catch(noop)
      .finally(() => window.setTimeout(() => !dragging.current && setDragOrder(null), 160));
  }, []);

  const onReorderPinned = useCallback(
    (ids: number[]) => setDragOrder({ pinned: ids, rest: orderRef.current.rest.map((t) => t.id) }),
    [],
  );
  const onReorderRest = useCallback(
    (ids: number[]) => setDragOrder({ pinned: orderRef.current.pinned.map((t) => t.id), rest: ids }),
    [],
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
    return computeTabWidths({
      available,
      pinnedInactive,
      inactive,
      hasActive: activeInSpace,
      separator: pinned.length > 0 && rest.length > 0,
    });
  }, [available, tabs, pinned, rest, activeTabId]);

  const renderItem = (tab: TabState) => (
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
    />
  );

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
              <Reorder.Group as="div" axis="x" values={pinned.map((t) => t.id)} onReorder={onReorderPinned} className="contents" role="presentation">
                <AnimatePresence initial={false} mode="popLayout">
                  {pinned.map(renderItem)}
                </AnimatePresence>
              </Reorder.Group>
            )}
            <AnimatePresence initial={false}>
              {pinned.length > 0 && rest.length > 0 && (
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
            <Reorder.Group as="div" axis="x" values={rest.map((t) => t.id)} onReorder={onReorderRest} className="contents" role="presentation">
              <AnimatePresence initial={false} mode="popLayout">
                {rest.map(renderItem)}
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
