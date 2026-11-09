import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { useSettings } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { IslandIconButton } from '../island/NavButtons';
import { IslandTooltip } from '../island/IslandTooltip';
import { SpaceSwitcher } from '../spaces/SpaceSwitcher';
import { VerticalTabList } from './VerticalTabList';

export const COLLAPSED_WIDTH = 52;
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 240;
/** Window padding (8) + gap to the next column (8): the top island starts this far right of the rail. */
const OUTER = 16;
const PEEK_DELAY_MS = 320;
const UNPEEK_DELAY_MS = 260;
const OPEN_SURFACE = '[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]';

const clampWidth = (width: number): number => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));

/**
 * Hover-to-peek for the collapsed rail: after a short hover the island expands over the page (the
 * overlay is held so the chrome view sits above the page meanwhile) and folds back once the pointer
 * leaves and no menu opened from it is still showing.
 */
function usePeek(enabled: boolean): { peek: boolean; onEnter: () => void; onLeave: () => void } {
  const [peek, setPeek] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useOverlayPresence(peek, 320);

  useEffect(() => {
    if (enabled) return;
    window.clearTimeout(timer.current);
    setPeek(false);
  }, [enabled]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onEnter = useCallback(() => {
    window.clearTimeout(timer.current);
    if (enabled) timer.current = window.setTimeout(() => setPeek(true), PEEK_DELAY_MS);
  }, [enabled]);

  const onLeave = useCallback(() => {
    window.clearTimeout(timer.current);
    const tick = (): void => {
      if (document.querySelector(OPEN_SURFACE)) timer.current = window.setTimeout(tick, UNPEEK_DELAY_MS);
      else setPeek(false);
    };
    timer.current = window.setTimeout(tick, UNPEEK_DELAY_MS);
  }, []);

  return { peek, onEnter, onLeave };
}

/**
 * Vertical tab layout: a floating island on the left, detached from the window edges like the top
 * island. It owns a spacer in App's row (so the page viewport and the top island make room) and
 * publishes the column's left edge as `--chrome-left` for the fixed top island.
 *
 * Width changes never let the page cover the island: when the island grows, the spacer jumps to the
 * final width first (page shrinks at once) and the island animates into the room; when it shrinks,
 * the spacer follows the animation and the page grows when it settles (Viewport reports on settle).
 */
export function VerticalIsland() {
  const { sidebarWidth, sidebarCollapsed: collapsed } = useSettings();
  const reduce = useReducedMotion();
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const width = clampWidth(liveWidth ?? sidebarWidth);
  const { peek, onEnter, onLeave } = usePeek(collapsed);
  const expanded = !collapsed || peek;
  const reserved = collapsed ? COLLAPSED_WIDTH : width;
  const resizing = liveWidth !== null;

  const reserve = useMotionValue(reserved);
  const previous = useRef(reserved);
  useEffect(() => {
    const growing = reserved >= previous.current;
    previous.current = reserved;
    if (growing || resizing || reduce) {
      reserve.jump(reserved);
      return;
    }
    const controls = animate(reserve, reserved, spring.soft);
    return () => controls.stop();
  }, [reserved, resizing, reduce, reserve]);

  const publish = useCallback((value: number) => {
    document.documentElement.style.setProperty('--chrome-left', `${Math.round(value) + OUTER}px`);
  }, []);
  useMotionValueEvent(reserve, 'change', publish);
  useLayoutEffect(() => {
    publish(reserve.get());
    return () => {
      document.documentElement.style.removeProperty('--chrome-left');
    };
  }, [publish, reserve]);

  const toggleCollapsed = (): void => settle(vela().settings.set({ sidebarCollapsed: !collapsed }));

  return (
    <>
      <motion.div aria-hidden className="shrink-0" style={{ width: reserve }} />
      <motion.aside
        aria-label="Tabs"
        className={cn(
          'island drag fixed top-2 bottom-2 left-2 flex flex-col overflow-hidden',
          peek
            ? 'z-40 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_24px_64px_-16px_rgb(0_0_0/0.7)]'
            : 'z-30',
        )}
        style={peek ? { background: 'var(--popover)' } : undefined}
        initial={false}
        animate={{ width: expanded ? width : COLLAPSED_WIDTH }}
        transition={resizing || reduce ? { duration: 0 } : spring.soft}
        onPointerEnter={collapsed ? onEnter : undefined}
        onPointerLeave={collapsed ? onLeave : undefined}
      >
        <header className={cn('flex shrink-0 items-center gap-1 px-2', expanded ? 'h-12' : 'h-auto flex-col pt-2 pb-1.5')}>
          <div className="no-drag flex min-w-0 items-center">
            <SpaceSwitcher compact={!expanded} />
          </div>
          {expanded && <div className="flex-1" />}
          <IslandTooltip label={collapsed ? 'Expand tabs' : 'Collapse tabs'}>
            <IslandIconButton aria-label={collapsed ? 'Expand tabs' : 'Collapse tabs'} onClick={toggleCollapsed}>
              {collapsed ? <PanelLeftOpenIcon size={15} strokeWidth={1.75} /> : <PanelLeftCloseIcon size={15} strokeWidth={1.75} />}
            </IslandIconButton>
          </IslandTooltip>
        </header>
        <VerticalTabList iconOnly={!expanded} />
        {!collapsed && <ResizeHandle width={width} onLive={setLiveWidth} />}
      </motion.aside>
    </>
  );
}

/** Drag the island's right edge to resize (persisted on release); double-click resets the width. */
function ResizeHandle({ width, onLive }: { width: number; onLive: (width: number | null) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef(width);

  const commit = (next: number): void => {
    void vela()
      .settings.set({ sidebarWidth: next })
      .catch(() => undefined)
      .finally(() => onLive(null));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    latest.current = width;
    onLive(width);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!start.current) return;
    latest.current = clampWidth(start.current.width + event.clientX - start.current.x);
    onLive(latest.current);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!start.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    start.current = null;
    commit(latest.current);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize tabs"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      className="group/resize no-drag absolute inset-y-4 right-0 w-2 cursor-col-resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => commit(DEFAULT_WIDTH)}
    >
      <span className="absolute inset-y-0 right-0.5 w-px rounded-full bg-space opacity-0 transition-opacity duration-150 group-hover/resize:opacity-60 group-active/resize:opacity-90" />
    </div>
  );
}
