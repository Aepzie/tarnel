import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, Reorder, motion, useReducedMotion } from 'motion/react';
import { PlusIcon } from 'lucide-react';
import { ArchiveButton } from '../archive/ArchiveButton';
import type { TabState } from '@shared/types';
import { useBrowserSlice, useSpaceGroups, useSpaceTabs } from '@/hooks/browser';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SPACE_HEX, settle, vela } from '@/lib/vela';
import { useEditingGroup } from '../tabs/groups/group-ui';
import { useUnitDrag } from '../tabs/groups/use-unit-drag';
import { PinnedGrid } from './PinnedGrid';
import { VerticalGroupHeader } from './VerticalGroupHeader';
import { VerticalTabRow } from './VerticalTabRow';
import { VerticalSplitRow } from './VerticalSplitRow';
import { useSpaceSplits } from '../split/split-state';

async function newTab(): Promise<void> {
  await vela().tabs.create({ active: true });
}

/** Top/bottom edge fades while the list has hidden content in that direction. */
function useVerticalFade(ref: React.RefObject<HTMLElement | null>): { top: boolean; bottom: boolean } {
  const [fade, setFade] = useState({ top: false, bottom: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setFade((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    if (el.firstElementChild) resize.observe(el.firstElementChild);
    el.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      el.removeEventListener('scroll', schedule);
    };
  }, [ref]);
  return fade;
}

/**
 * Tab list of the vertical island: pinned grid, then tabs and groups as collapsible sections in one
 * reorderable column, then "New tab". `iconOnly` renders the collapsed (icon rail) variant.
 */
export function VerticalTabList({ iconOnly }: { iconOnly: boolean }) {
  const tabs = useSpaceTabs();
  const groups = useSpaceGroups();
  const editingGroup = useEditingGroup();
  const activeTabId = useBrowserSlice((s) => s.activeTabId);
  const activeSpaceId = useBrowserSlice((s) => s.activeSpaceId);
  const reduced = !!useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fade = useVerticalFade(scrollRef);

  const { pinned, rest } = useMemo(() => {
    const pinned: TabState[] = [];
    const rest: TabState[] = [];
    for (const tab of tabs) (tab.pinned ? pinned : rest).push(tab);
    return { pinned, rest };
  }, [tabs]);

  const splits = useSpaceSplits();
  const drag = useUnitDrag(rest, groups, splits, activeTabId, activeSpaceId);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || activeTabId == null) return;
    const frame = requestAnimationFrame(() => {
      scroller
        .querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTabId, activeSpaceId, reduced]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home' && event.key !== 'End') return;
    const all = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[role="tab"], [aria-expanded]') ?? []);
    const current = all.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (current + step + all.length) % all.length;
    all[next]?.focus();
  };

  const layoutTransition = reduced ? { duration: 0 } : spring.snappy;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={activeSpaceId}
          className="flex min-h-0 flex-1 flex-col"
          initial={reduced ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: -12, transition: { duration: 0.12 } }}
          transition={reduced ? { duration: 0 } : spring.soft}
        >
          {pinned.length > 0 && <PinnedGrid tabs={pinned} activeTabId={activeTabId} />}
          {pinned.length > 0 && <div aria-hidden className="mx-3 mb-1.5 h-px shrink-0 bg-border" />}
          <motion.div
            ref={scrollRef}
            layoutScroll
            role="tablist"
            aria-label="Tabs"
            aria-orientation="vertical"
            onKeyDown={onKeyDown}
            className="min-h-0 flex-1 scroll-py-2 overflow-x-hidden overflow-y-auto overscroll-contain p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{
              maskImage: `linear-gradient(to bottom, transparent 0, #000 ${fade.top ? 16 : 0}px, #000 calc(100% - ${fade.bottom ? 16 : 0}px), transparent 100%)`,
            }}
          >
            <Reorder.Group as="div" axis="y" values={drag.units.map((unit) => unit.key)} onReorder={drag.onReorder} className="flex flex-col gap-0.5" role="presentation">
              <AnimatePresence initial={false} mode="popLayout">
                {drag.units.map((unit) =>
                  unit.kind === 'group' ? (
                    <VerticalGroupHeader
                      key={unit.key}
                      group={unit.group}
                      count={unit.count}
                      iconOnly={iconOnly}
                      editing={editingGroup === unit.group.id}
                      onDragStart={drag.onGroupDragStart}
                      onDragEnd={drag.onGroupDragEnd}
                    />
                  ) : unit.kind === 'split' ? (
                    <VerticalSplitRow
                      key={unit.key}
                      unit={unit}
                      activeTabId={activeTabId}
                      iconOnly={iconOnly}
                      groupColor={unit.group ? SPACE_HEX[unit.group.color] : undefined}
                      groupEnd={unit.lastInGroup}
                      onDragStart={drag.onSplitDragStart}
                      onDragEnd={drag.onSplitDragEnd}
                    />
                  ) : (
                    <VerticalTabRow
                      key={unit.key}
                      tab={unit.tab}
                      active={unit.tab.id === activeTabId}
                      iconOnly={iconOnly}
                      groupColor={unit.group ? SPACE_HEX[unit.group.color] : undefined}
                      groupEnd={unit.lastInGroup}
                      onDragStart={drag.onTabDragStart}
                      onDragEnd={drag.onTabDragEnd}
                    />
                  ),
                )}
              </AnimatePresence>
              <motion.button
                type="button"
                layout="position"
                transition={layoutTransition}
                aria-label="New tab"
                title={iconOnly ? 'New tab' : undefined}
                onClick={() => settle(newTab())}
                className={cn(
                  'no-drag flex h-8 shrink-0 items-center gap-2.5 rounded-[10px] text-[13px] tracking-tight text-zinc-500 outline-none',
                  'transition-colors duration-150 hover:bg-accent hover:text-zinc-100 light:hover:text-zinc-900',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] active:scale-[0.98]',
                  iconOnly ? 'justify-center' : 'pl-2.5',
                )}
              >
                <PlusIcon className="size-4 shrink-0" strokeWidth={1.75} />
                {!iconOnly && 'New Tab'}
              </motion.button>
              <ArchiveButton layoutTransition={layoutTransition} row iconOnly={iconOnly} />
            </Reorder.Group>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
