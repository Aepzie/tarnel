import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { ArrowDownToLine, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useOverlayPresence } from '@/hooks/overlay';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { DownloadCard } from './DownloadCard';
import { aggregateProgress, downloads, useDownloads } from './downloads-store';

const RING_RADIUS = 11.5;
const CHECK_MS = 1400;
/** Keep the chrome raised while the popover's close animation plays. */

/**
 * Island icon button: progress ring while downloading, check pulse on completion, dot badge until
 * opened. Renders nothing until the first download of the session.
 */
export function DownloadsButton() {
  const { entries, unseen, completions } = useDownloads();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  const lastCompletions = useRef(completions);

  const hasEntries = entries.length > 0;
  useOverlayPresence(open && hasEntries);

  useEffect(() => {
    if (hasEntries || !open) return;
    setOpen(false);
  }, [hasEntries, open]);

  useEffect(() => {
    if (completions === lastCompletions.current) return;
    lastCompletions.current = completions;
    setShowCheck(true);
    const timer = window.setTimeout(() => setShowCheck(false), CHECK_MS);
    return () => window.clearTimeout(timer);
  }, [completions]);

  useEffect(() => {
    if (open && unseen) downloads.markSeen();
  }, [open, unseen]);

  if (!hasEntries) return null;

  const { active, ratio } = aggregateProgress(entries);
  const downloading = active > 0;
  const hasFinished = entries.some((entry) => entry.download.state !== 'progressing');

  const onOpenChange = (next: boolean): void => {
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          aria-label={downloading ? `Downloads, ${active} in progress` : 'Downloads'}
          title="Downloads"
          className={cn(
            'no-drag relative grid size-7 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-[background-color,color] duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]',
            (open || downloading) && 'text-foreground',
            open && 'bg-accent',
          )}
          initial={reduce ? false : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={spring.pop}
        >
          <ProgressRing visible={downloading} ratio={ratio} reduce={!!reduce} />

          <AnimatePresence mode="popLayout" initial={false}>
            {showCheck ? (
              <motion.span
                key="check"
                className="grid place-items-center text-space"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: -30 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                transition={spring.pop}
              >
                <Check className="size-4" strokeWidth={2.25} />
              </motion.span>
            ) : (
              <motion.span
                key="icon"
                className="grid place-items-center"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, y: -4 }}
                animate={{ opacity: 1, scale: downloading ? 0.82 : 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                transition={spring.pop}
              >
                <ArrowDownToLine className="size-4" strokeWidth={1.75} />
              </motion.span>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showCheck && !reduce && (
              <motion.span
                key={`pulse-${completions}`}
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-space"
                initial={{ opacity: 0.7, scale: 0.7 }}
                animate={{ opacity: 0, scale: 1.6 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: ease.out }}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {unseen && !open && (
              <motion.span
                aria-hidden
                className="absolute top-0.5 right-0.5 size-[7px] rounded-full bg-space shadow-[0_0_0_2px_var(--island),0_0_6px_var(--accent-space)]"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={spring.pop}
              />
            )}
          </AnimatePresence>
        </motion.button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={10}
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-80 overflow-hidden rounded-2xl border-0 bg-popover p-0 shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_24px_64px_-12px_rgb(0_0_0/0.55)] backdrop-blur-2xl backdrop-saturate-150"
      >
        <div className="flex h-10 items-center justify-between px-3.5">
          <span className="text-[12.5px] font-semibold tracking-tight text-foreground">Downloads</span>
          <span className="flex items-center gap-2">
            {downloading && (
              <span className="rounded-full bg-space/15 px-2 py-0.5 text-[10.5px] font-medium text-space tabular-nums">
                {active} active
              </span>
            )}
            <button
              type="button"
              disabled={!hasFinished}
              onClick={() => downloads.clearFinished()}
              className="h-6 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-[background-color,color] duration-150 hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              Clear all
            </button>
          </span>
        </div>
        <div className="mx-3 h-px bg-border" />
        <div className="max-h-[min(420px,60vh)] overflow-x-hidden overflow-y-auto overscroll-contain p-1.5">
          <LayoutGroup>
            <AnimatePresence mode="popLayout" initial={false}>
              {entries.map((entry) => (
                <DownloadCard key={entry.download.id} entry={entry} />
              ))}
            </AnimatePresence>
          </LayoutGroup>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProgressRing({ visible, ratio, reduce }: { visible: boolean; ratio: number | null; reduce: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.svg
          key="ring"
          aria-hidden
          viewBox="0 0 28 28"
          className="pointer-events-none absolute inset-0 size-7 -rotate-90"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.15, transition: { duration: 0.2, ease: ease.out } }}
          transition={spring.pop}
        >
          <circle cx="14" cy="14" r={RING_RADIUS} fill="none" strokeWidth="2" className="stroke-foreground/10" />
          {ratio === null ? (
            <motion.circle
              cx="14"
              cy="14"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              className="stroke-space"
              style={{ originX: '50%', originY: '50%' }}
              initial={{ pathLength: 0.28, rotate: 0 }}
              animate={reduce ? { pathLength: 0.28 } : { pathLength: 0.28, rotate: 360 }}
              transition={{ rotate: { duration: 1, ease: 'linear', repeat: Infinity } }}
            />
          ) : (
            <motion.circle
              cx="14"
              cy="14"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              className="stroke-space drop-shadow-[0_0_3px_var(--accent-space)]"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: Math.max(0.02, ratio) }}
              transition={reduce ? { duration: 0 } : spring.soft}
            />
          )}
        </motion.svg>
      )}
    </AnimatePresence>
  );
}
