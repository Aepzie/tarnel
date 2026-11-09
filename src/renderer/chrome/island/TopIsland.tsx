import { useRef, type MouseEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useSettings } from '@/hooks/browser';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useChromeUI } from '../ui-store';
import { SpaceSwitcher } from '../spaces/SpaceSwitcher';
import { TabStrip } from '../tabs/TabStrip';
import { PerfChip } from '../perf/PerfChip';
import { DownloadsButton } from '../downloads/DownloadsButton';
import { NavButtons } from './NavButtons';
import { CaptionButtons, TrafficLights } from './WindowControls';
import { useIslandReveal } from './useIslandReveal';
import { OmniboxBar } from '../vertical/OmniboxBar';
import { settle } from '@/lib/vela';

const ISLAND_HEIGHT = 44;
/** App's column gap; the collapsed spacer cancels it so focus mode leaves exactly one 8px margin. */
const APP_GAP = 8;
const isMac = typeof window !== 'undefined' && window.vela?.platform === 'darwin';

const Divider = () => <div aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />;

/**
 * Floating top island: nav · space · tabs/omnibox · perf · window controls.
 *
 * The island itself is always `position: fixed` at the top inset and only ever animates
 * transform/opacity. A sibling spacer reserves its slot in App's flex column and collapses in focus
 * mode, which is what lets the page viewport grow. When revealed in focus mode the island floats
 * over the page (overlay held) with a deeper shadow.
 */
export function TopIsland() {
  const { autoHideToolbar: autoHide, tabLayout } = useSettings();
  const { islandRevealed, palette } = useChromeUI();
  const reduce = useReducedMotion();
  const islandRef = useRef<HTMLElement>(null);
  const { visible, onEdgeEnter, onIslandEnter, onLeave, onSettled } = useIslandReveal(
    autoHide,
    islandRevealed,
    palette.open,
    islandRef,
  );
  const floating = autoHide && islandRevealed;
  const transition = reduce ? { duration: 0 } : spring.soft;

  const onDoubleClick = (event: MouseEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('.no-drag, button, a, input, [role="tab"]')) return;
    settle(window.vela.window.toggleMaximize());
  };

  return (
    <>
      <motion.div
        aria-hidden
        className="shrink-0"
        initial={false}
        animate={{ height: autoHide ? 0 : ISLAND_HEIGHT, marginBottom: autoHide ? -APP_GAP : 0 }}
        transition={transition}
      />

      {autoHide && (
        <div
          aria-hidden
          className="no-drag fixed inset-x-0 top-0 z-50 h-1.5"
          onPointerEnter={onEdgeEnter}
          onPointerLeave={onLeave}
        />
      )}

      <motion.header
        ref={islandRef}
        aria-label="Browser toolbar"
        inert={!visible}
        className={cn(
          'island drag fixed top-2 right-2 left-[var(--chrome-left,0.5rem)] flex h-11 items-center gap-1 rounded-2xl px-2',
          isMac && 'pl-3',
          floating ? 'z-40' : 'z-30',
          !visible && 'pointer-events-none',
        )}
        initial={false}
        animate={visible ? { y: 0, opacity: 1 } : { y: -56, opacity: 0 }}
        transition={transition}
        onAnimationComplete={onSettled}
        onPointerEnter={onIslandEnter}
        onPointerLeave={autoHide ? onLeave : undefined}
        onDoubleClick={onDoubleClick}
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-2xl shadow-[0_24px_64px_-16px_rgb(0_0_0/0.7),0_8px_20px_-8px_rgb(0_0_0/0.4)] light:shadow-[0_20px_48px_-16px_rgb(0_0_0/0.22),0_6px_16px_-8px_rgb(0_0_0/0.12)]"
          initial={false}
          animate={{ opacity: floating ? 1 : 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.24 }}
        />
        <GlowLine />

        {isMac && (
          <>
            <TrafficLights />
            <Divider />
          </>
        )}
        <NavButtons />
        <Divider />
        {tabLayout === 'vertical' ? (
          <OmniboxBar />
        ) : (
          <>
            <div className="no-drag flex shrink-0 items-center">
              <SpaceSwitcher />
            </div>
            <div className="flex h-full min-w-0 flex-1 items-center">
              <TabStrip />
            </div>
          </>
        )}
        <div className="no-drag flex shrink-0 items-center gap-1">
          <DownloadsButton />
          <PerfChip />
        </div>
        {!isMac && (
          <>
            <Divider />
            <CaptionButtons />
          </>
        )}
      </motion.header>
    </>
  );
}

/** Space-tinted hairline along the island's bottom edge, fading out toward the corners. */
function GlowLine() {
  const line =
    'linear-gradient(90deg, transparent, color-mix(in oklab, var(--accent-space) 25%, transparent) 30%, color-mix(in oklab, var(--accent-space) 25%, transparent) 70%, transparent)';
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-6 bottom-0 h-px">
      <div className="absolute inset-0" style={{ backgroundImage: line }} />
      <div className="absolute inset-x-8 -inset-y-px opacity-40 blur-[3px]" style={{ backgroundImage: line }} />
    </div>
  );
}
