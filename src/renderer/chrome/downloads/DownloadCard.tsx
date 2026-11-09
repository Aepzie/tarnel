import { forwardRef, memo, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, FolderOpen, SquareArrowOutUpRight, TriangleAlert, X } from 'lucide-react';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { downloads, type DownloadEntry } from './downloads-store';
import { extensionOf, fileIconFor, formatSize } from './file-icon';
import { settle } from '@/lib/vela';

/** One row in the downloads popover: icon, name, progress, speed, actions. */
export const DownloadCard = memo(
  forwardRef<HTMLDivElement, { entry: DownloadEntry }>(function DownloadCard({ entry }, ref) {
    const reduce = useReducedMotion();
    const { download, rate } = entry;
    const { id, filename, receivedBytes, totalBytes, state } = download;
    const done = state === 'completed';
    const failed = state === 'cancelled' || state === 'interrupted';
    const finished = done || failed;
    const indeterminate = !finished && totalBytes <= 0;
    const ratio = done ? 1 : totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0;
    const Icon = fileIconFor(filename);
    const extension = extensionOf(filename);

    let meta: string;
    if (done) meta = formatSize(totalBytes > 0 ? totalBytes : receivedBytes);
    else if (failed) meta = state === 'cancelled' ? 'Cancelled' : 'Failed — interrupted';
    else if (totalBytes > 0) meta = `${formatSize(receivedBytes)} / ${formatSize(totalBytes)}`;
    else meta = formatSize(receivedBytes);
    const speed = !finished && rate > 0 ? `${formatSize(rate)}/s` : '';

    return (
      <motion.div
        ref={ref}
        layout
        className="group/card relative rounded-xl p-2.5 transition-colors duration-150 hover:bg-foreground/[0.04]"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, x: 0, filter: 'blur(0px)' }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, x: 16, filter: 'blur(4px)', transition: { duration: 0.16, ease: ease.out } }}
        transition={spring.soft}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'relative grid size-9 shrink-0 place-items-center rounded-lg ring-1 ring-border transition-colors duration-200',
              done ? 'bg-space/15 text-space' : failed ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-muted-foreground',
            )}
          >
            <Icon className="size-[18px]" strokeWidth={1.6} />
            <AnimatePresence>
              {finished && (
                <motion.span
                  className={cn(
                    'absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full ring-2 ring-popover',
                    done ? 'bg-space text-primary-foreground' : 'bg-destructive text-white',
                  )}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={spring.pop}
                >
                  {done ? <Check className="size-2.5" strokeWidth={3} /> : <TriangleAlert className="size-2.5" strokeWidth={2.5} />}
                </motion.span>
              )}
            </AnimatePresence>
          </span>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight text-foreground" title={filename}>
                {filename}
              </span>
              {extension && (
                <span className="shrink-0 rounded-[4px] bg-secondary px-1 text-[9.5px] font-semibold tracking-wider text-muted-foreground uppercase ring-1 ring-border">
                  {extension.slice(0, 5)}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground tabular-nums">
              <span className={cn('truncate', failed && 'text-destructive')}>{meta}</span>
              {speed && <span className="shrink-0 text-muted-foreground/70">{speed}</span>}
            </div>
          </div>

          <button
            type="button"
            aria-label="Remove from list"
            title="Remove from list"
            onClick={() => downloads.dismiss(id)}
            className="-mt-0.5 -mr-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-[background-color,color,opacity,transform] duration-150 group-hover/card:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 active:scale-[0.92]"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <AnimatePresence initial={false} mode="popLayout">
          {!finished ? (
            <motion.div
              key="progress"
              className="mt-2.5 ml-12 h-1 overflow-hidden rounded-full bg-foreground/[0.08]"
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              {indeterminate ? (
                <div className="h-full w-2/5 animate-shimmer rounded-full bg-[linear-gradient(90deg,transparent,var(--accent-space),transparent)]" />
              ) : (
                <motion.div
                  className="h-full origin-left rounded-full bg-space shadow-[0_0_8px_var(--accent-space)]"
                  initial={false}
                  animate={{ scaleX: ratio }}
                  transition={reduce ? { duration: 0 } : spring.soft}
                />
              )}
            </motion.div>
          ) : done ? (
            <motion.div
              key="actions"
              className="mt-2 ml-12 flex gap-1.5"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.soft, delay: 0.05 }}
            >
              <CardAction onClick={() => settle(window.vela.downloads.open(id))} primary>
                <SquareArrowOutUpRight className="size-3.5" strokeWidth={1.75} />
                Open
              </CardAction>
              <CardAction onClick={() => settle(window.vela.downloads.show(id))}>
                <FolderOpen className="size-3.5" strokeWidth={1.75} />
                Show in folder
              </CardAction>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    );
  }),
);

function CardAction({ children, onClick, primary = false }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium ring-1 transition-[background-color,color,transform] duration-150 active:scale-[0.96]',
        primary
          ? 'bg-space/15 text-space ring-space/25 hover:bg-space/25'
          : 'bg-secondary text-foreground/85 ring-border hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
