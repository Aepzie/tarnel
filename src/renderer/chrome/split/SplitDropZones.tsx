import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import { SPLIT_DEFAULT_RATIO, splitGeometry } from '@shared/split-layout';
import { ease } from '@/lib/motion';
import { FLOATING_SURFACE } from './PaneToolbar';
import { panesAfterDrop, splitDrag, type DropSide } from './split-state';
import { useElementSize } from './use-element-size';

/** Share of the page area's width on each side that acts as a drop zone. */
const EDGE_SHARE = 0.32;

/**
 * Drop targets shown over the page area while a tab is dragged: hints along both edges, and a
 * preview of the pane the tab will take once the pointer is over a zone. Rendered with the overlay
 * held (see `splitDrag.begin`), so they paint above the page and own the pointer.
 */
export function SplitDropZones({ tabId, side }: { tabId: number; side: DropSide | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const reduced = !!useReducedMotion();

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const inside = event.clientY >= box.top && event.clientY <= box.bottom && event.clientX >= box.left && event.clientX <= box.right;
      const x = (event.clientX - box.left) / Math.max(1, box.width);
      splitDrag.setSide(!inside ? null : x <= EDGE_SHARE ? 'left' : x >= 1 - EDGE_SHARE ? 'right' : null);
    };
    document.addEventListener('pointermove', onMove);
    return () => document.removeEventListener('pointermove', onMove);
  }, []);

  const count = panesAfterDrop(tabId);
  const geometry = size ? splitGeometry({ x: 0, y: 0, ...size }, count, SPLIT_DEFAULT_RATIO, SPLIT_DEFAULT_RATIO, true) : null;
  const target = geometry && side ? geometry.panes[side === 'left' ? 0 : count - 1] : undefined;
  const fade = { duration: reduced ? 0 : 0.18, ease: ease.out };

  return (
    <motion.div
      ref={ref}
      className="pointer-events-none absolute inset-0 z-30"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fade}
    >
      {(['left', 'right'] as const).map((edge) => (
        <span
          key={edge}
          aria-hidden="true"
          className={`absolute inset-y-6 w-1 rounded-full bg-space/40 transition-opacity duration-150 ${edge === 'left' ? 'left-1.5' : 'right-1.5'} ${side ? 'opacity-0' : 'opacity-100'}`}
        />
      ))}
      <AnimatePresence>
        {target && side && (
          <motion.div
            key={side}
            className="absolute flex items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--accent-space)_14%,transparent)] shadow-[0_0_0_1.5px_color-mix(in_oklab,var(--accent-space)_60%,transparent),inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-[2px]"
            style={{ left: target.x, top: target.y, width: target.width, height: target.height }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.12 } }}
            transition={fade}
          >
            <span className={`flex h-8 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium tracking-tight ${FLOATING_SURFACE}`}>
              {side === 'left' ? <PanelLeftIcon className="size-[15px] text-space" strokeWidth={1.75} /> : <PanelRightIcon className="size-[15px] text-space" strokeWidth={1.75} />}
              {side === 'left' ? 'Open on the left' : 'Open on the right'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
