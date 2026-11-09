import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeftRightIcon, Columns2Icon, XIcon } from 'lucide-react';
import type { ContentBounds, TabSplit } from '@shared/types';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { IslandTooltip } from '../island/IslandTooltip';

/** Near-opaque glass for surfaces floating over a page (nothing behind them can be blurred). */
export const FLOATING_SURFACE =
  'bg-popover text-popover-foreground ring-1 ring-white/10 light:ring-black/10 shadow-[0_10px_28px_-10px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.06)]';

/** Zone (around a pane's top center) that keeps the toolbar open; a superset of main's 200×40 hot zone. */
const KEEP_WIDTH = 300;
const KEEP_HEIGHT = 60;
const HIDE_DELAY_MS = 180;
/** Keep the chrome raised until the exit animation is done. */
const LOWER_DELAY_MS = 160;

/**
 * Tiny floating toolbar of a split pane. Main reports when the pointer reaches the top center of a
 * pane (the page view owns the pointer there); the chrome is then raised over the pages without
 * taking keyboard focus (`split.peek`) and tracks the pointer itself until it leaves the zone.
 */
export function PaneToolbar({ split, panes, containerRef }: { split: TabSplit; panes: ContentBounds[]; containerRef: RefObject<HTMLElement | null> }) {
  const reduced = !!useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);
  const memberKey = split.tabIds.join(',');

  useEffect(() => {
    const members = memberKey.split(',').map(Number);
    return vela().split.onHover((tabId) => {
      if (tabId !== null && members.includes(tabId)) setHovered(tabId);
    });
  }, [memberKey]);

  const index = hovered === null ? -1 : split.tabIds.indexOf(hovered);
  const pane = index === -1 ? undefined : panes[index];
  const open = pane !== undefined;

  useEffect(() => {
    if (hovered !== null && index === -1) setHovered(null);
  }, [hovered, index]);

  usePeek(open);

  const paneRef = useRef(pane);
  paneRef.current = pane;
  useEffect(() => {
    if (!open) return;
    let timer = 0;
    const hide = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHovered(null), HIDE_DELAY_MS);
    };
    const onMove = (event: PointerEvent): void => {
      const current = paneRef.current;
      const box = containerRef.current?.getBoundingClientRect();
      if (!current || !box) return;
      const x = event.clientX - box.left - (current.x + current.width / 2);
      const y = event.clientY - box.top - current.y;
      if (Math.abs(x) <= KEEP_WIDTH / 2 && y >= -12 && y <= KEEP_HEIGHT) window.clearTimeout(timer);
      else hide();
    };
    const root = document.documentElement;
    document.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', hide);
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', hide);
      window.removeEventListener('blur', hide);
    };
  }, [open, containerRef]);

  const tabId = hovered;
  const run = (action: Promise<unknown>): void => {
    setHovered(null);
    settle(action);
  };

  return (
    <AnimatePresence>
      {pane && tabId !== null && (
        <motion.div
          key="pane-toolbar"
          role="toolbar"
          aria-label="Split pane"
          className={cn('no-drag pointer-events-auto absolute z-20 flex h-8 -translate-x-1/2 items-center gap-0.5 rounded-full p-0.5', FLOATING_SURFACE)}
          style={{ left: pane.x + pane.width / 2, top: pane.y + 8 }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.96, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, y: -4, scale: 0.97, filter: 'blur(2px)', transition: { duration: 0.12 } }}
          transition={reduced ? { duration: 0.1 } : spring.soft}
        >
          <ToolbarButton label={split.tabIds.length === 2 ? 'Swap sides' : 'Rotate panes'} onClick={() => run(vela().split.swap(split.id))}>
            <ArrowLeftRightIcon className="size-[15px]" strokeWidth={1.75} />
          </ToolbarButton>
          <ToolbarButton label="Close split" keys={[modKey(), 'Shift', 'D']} onClick={() => run(vela().split.close(split.id))}>
            <Columns2Icon className="size-[15px]" strokeWidth={1.75} />
          </ToolbarButton>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-white/10 light:bg-black/10" />
          <ToolbarButton label="Close tab" onClick={() => run(vela().tabs.close(tabId))}>
            <XIcon className="size-[15px]" strokeWidth={1.75} />
          </ToolbarButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function modKey(): string {
  return window.vela?.platform === 'darwin' ? '⌘' : 'Ctrl';
}

function ToolbarButton({ label, keys, onClick, children }: { label: string; keys?: string[]; onClick: () => void; children: ReactNode }) {
  return (
    <IslandTooltip label={label} keys={keys}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="inline-flex size-7 items-center justify-center rounded-full text-zinc-400 outline-none transition-colors duration-150 hover:bg-accent hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-[var(--ring)] active:scale-[0.94] light:text-zinc-500 light:hover:text-zinc-900"
      >
        {children}
      </button>
    </IslandTooltip>
  );
}

/** Raise the chrome without focus while `open`; lower it once the exit animation is over. */
function usePeek(open: boolean): void {
  useEffect(() => {
    if (open) {
      settle(vela().split.peek(true));
      return;
    }
    const timer = window.setTimeout(() => settle(vela().split.peek(false)), LOWER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => () => settle(vela().split.peek(false)), []);
}
