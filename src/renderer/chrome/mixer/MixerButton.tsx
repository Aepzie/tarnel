import { useCallback, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { SlidersVerticalIcon } from 'lucide-react';
import type { UICommand } from '@shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useBrowserSlice, useCommand, useSettings } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ui } from '../ui-store';
import { MIXER_SHORTCUT } from './mixer-commands';
import { MixerPanel } from './MixerPanel';
import { mixerPanel, useMixer } from './mixer-store';

const BAR_HEIGHTS = [[0.35, 1, 0.5], [0.8, 0.3, 1], [0.5, 0.9, 0.3]];

/** Three tiny bouncing bars: some tab is playing right now. */
function Activity({ reduce }: { reduce: boolean }) {
  return (
    <motion.span
      aria-hidden
      className="absolute -top-px -right-px flex h-[11px] items-end gap-[1.5px] rounded-full bg-[var(--island)] px-[3px] py-[2px]"
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.4 }}
      transition={spring.pop}
    >
      {BAR_HEIGHTS.map((heights, index) => (
        <motion.span
          key={index}
          className="h-full w-[2px] origin-bottom rounded-full bg-space"
          initial={{ scaleY: heights[0] }}
          animate={reduce ? { scaleY: 0.7 } : { scaleY: heights }}
          transition={reduce ? { duration: 0 } : { duration: 0.9 + index * 0.17, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        />
      ))}
    </motion.span>
  );
}

/**
 * Island button opening the per-tab audio mixer (also Ctrl+Shift+M and the palette). Shows a tiny
 * live activity indicator while any tab plays sound.
 */
export function MixerButton() {
  const mixer = useMixer();
  const { autoHideToolbar } = useSettings();
  const reduce = !!useReducedMotion();
  const contentRef = useRef<HTMLDivElement>(null);
  const audible = useBrowserSlice((state) => state.tabs.some((tab) => tab.audible && !tab.muted));
  const playing = audible || mixer.simulated.length > 0;
  useOverlayPresence(mixer.open);

  const onCommand = useCallback(
    (command: UICommand): void => {
      if (command === 'escape') {
        mixerPanel.close();
        return;
      }
      if (command !== 'audio-mixer') return;
      if (autoHideToolbar) ui.setIslandRevealed(true);
      mixerPanel.toggle();
    },
    [autoHideToolbar],
  );
  useCommand(onCommand);

  return (
    <Popover open={mixer.open} onOpenChange={mixerPanel.setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={playing ? 'Audio mixer, sound playing' : 'Audio mixer'}
          title={`Audio mixer (${MIXER_SHORTCUT})`}
          className={cn(
            'no-drag relative grid size-7 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-[background-color,color] duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]',
            mixer.open && 'bg-accent text-foreground',
          )}
        >
          <SlidersVerticalIcon className="size-4" strokeWidth={1.75} />
          <AnimatePresence>{playing && <Activity key="activity" reduce={reduce} />}</AnimatePresence>
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        sideOffset={10}
        collisionPadding={8}
        aria-label="Audio mixer"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        className="w-auto max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border-0 bg-popover p-0 outline-none shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_24px_64px_-12px_rgb(0_0_0/0.55)] backdrop-blur-2xl backdrop-saturate-150 light:shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_20px_48px_-16px_rgb(0_0_0/0.25)]"
      >
        <MixerPanel />
      </PopoverContent>
    </Popover>
  );
}
