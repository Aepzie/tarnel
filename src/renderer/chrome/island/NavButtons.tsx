import { forwardRef, type ComponentPropsWithoutRef, type MouseEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, RotateCw, X } from 'lucide-react';
import { useActiveTab } from '@/hooks/browser';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { IslandTooltip } from './IslandTooltip';
import { settle } from '@/lib/vela';

const ICON = { size: 15, strokeWidth: 1.75 } as const;

const isMac = typeof window !== 'undefined' && window.vela?.platform === 'darwin';
const ALT = isMac ? '⌥' : 'Alt';
const MOD = isMac ? '⌘' : 'Ctrl';

/** 28px ghost icon button used across the island. */
export const IslandIconButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(
  function IslandIconButton({ className, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'no-drag inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none',
          'transition-[background-color,color,transform,opacity] duration-120 ease-out',
          'hover:bg-accent hover:text-foreground active:scale-[0.96]',
          'focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-35',
          className,
        )}
        {...props}
      />
    );
  },
);

export function NavButtons() {
  const tab = useActiveTab();
  const reduce = useReducedMotion();
  const id = tab?.id;
  const loading = !!tab?.loading;

  const onReload = (event: MouseEvent<HTMLButtonElement>): void => {
    if (id === undefined) return;
    if (loading) settle(window.vela.tabs.stop(id));
    else settle(window.vela.tabs.reload(id, event.shiftKey || event.ctrlKey || event.metaKey));
  };

  const swapIn = reduce ? { opacity: 0 } : { opacity: 0, rotate: -90, scale: 0.6 };
  const swapOut = reduce ? { opacity: 0 } : { opacity: 0, rotate: 90, scale: 0.6 };

  return (
    <div className="no-drag flex shrink-0 items-center gap-1">
      <IslandTooltip label="Back" keys={[ALT, '←']}>
        <IslandIconButton
          aria-label="Back"
          disabled={!tab?.canGoBack}
          onClick={() => id !== undefined && settle(window.vela.tabs.back(id))}
        >
          <ArrowLeft {...ICON} />
        </IslandIconButton>
      </IslandTooltip>
      <IslandTooltip label="Forward" keys={[ALT, '→']}>
        <IslandIconButton
          aria-label="Forward"
          disabled={!tab?.canGoForward}
          onClick={() => id !== undefined && settle(window.vela.tabs.forward(id))}
        >
          <ArrowRight {...ICON} />
        </IslandIconButton>
      </IslandTooltip>
      <IslandTooltip label={loading ? 'Stop' : 'Reload'} keys={loading ? ['Esc'] : [MOD, 'R']}>
        <IslandIconButton aria-label={loading ? 'Stop loading' : 'Reload'} disabled={!tab} onClick={onReload}>
          <span className="grid place-items-center">
            <AnimatePresence initial={false}>
              <motion.span
                key={loading ? 'stop' : 'reload'}
                className="col-start-1 row-start-1 flex"
                initial={swapIn}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={swapOut}
                transition={reduce ? { duration: 0.12 } : spring.pop}
              >
                {loading ? <X {...ICON} /> : <RotateCw {...ICON} />}
              </motion.span>
            </AnimatePresence>
          </span>
        </IslandIconButton>
      </IslandTooltip>
    </div>
  );
}
