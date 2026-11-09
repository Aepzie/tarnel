import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertCircle, ArrowDownToLine, CircleFadingArrowUp, ExternalLink, RotateCw, ScrollText } from 'lucide-react';
import type { UpdateStatus } from '@shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useOverlayPresence } from '@/hooks/overlay';
import { formatRate, notifyReasonText, useUpdateStatus } from '@/hooks/updates';
import { ease, spring } from '@/lib/motion';
import { settle, vela } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { GLASS_SURFACE } from '../spaces/surface';
import { ReleaseNotesDialog } from './ReleaseNotesDialog';

const updatesApi = typeof window !== 'undefined' ? window.vela?.updates : undefined;

type ChipKind = 'ready' | 'available' | 'downloading' | 'failed';

/** The chip only speaks up when the user can act; background checks/downloads stay silent. */
function chipKind(status: UpdateStatus | null): ChipKind | null {
  if (!status?.version) return null;
  if (status.phase === 'ready') return 'ready';
  if (status.phase === 'available') return 'available';
  if (status.manual && status.phase === 'downloading') return 'downloading';
  if (status.manual && status.phase === 'error') return 'failed';
  return null;
}

const CHIP_LABEL: Record<ChipKind, string> = {
  ready: 'Update ready',
  available: 'Update available',
  downloading: 'Updating',
  failed: 'Update failed',
};

const PRIMARY =
  'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-space px-3 text-[12.5px] font-semibold text-zinc-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_6px_20px_-8px_var(--accent-space)] transition-[filter,transform] duration-150 outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.96]';
const GHOST =
  'flex h-8 items-center justify-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]';

/**
 * Top-island update chip ("Update ready · Restart"). Opens a small glass popover with the version,
 * "What's new" and the one action that fits this build: restart, download, or open the release page.
 */
export function UpdateChip() {
  const status = useUpdateStatus(updatesApi);
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const kind = chipKind(status);
  const visible = kind !== null && `${status?.version}:${kind}` !== dismissed;
  useOverlayPresence(open && visible);

  useEffect(() => {
    if (!visible && open) setOpen(false);
  }, [visible, open]);

  const act = (run: () => Promise<void>): void => {
    setOpen(false);
    settle(run());
  };

  return (
    <>
      <AnimatePresence initial={false}>
        {visible && status && kind && (
          <Popover key="update-chip" open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <motion.button
                type="button"
                aria-label={`${CHIP_LABEL[kind]}: Vela ${status.version}`}
                className={cn(
                  'no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-medium tracking-tight whitespace-nowrap tabular-nums',
                  'outline-none transition-[background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]',
                  kind === 'failed'
                    ? 'text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent'
                    : 'bg-space/12 text-space ring-1 ring-space/25 ring-inset hover:bg-space/20 data-[state=open]:bg-space/20',
                )}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, transition: { duration: 0.14, ease: ease.out } }}
                transition={spring.pop}
              >
                {kind === 'failed' ? (
                  <AlertCircle className="size-[15px]" strokeWidth={1.75} />
                ) : (
                  <CircleFadingArrowUp className="size-[15px]" strokeWidth={1.75} />
                )}
                <span>{CHIP_LABEL[kind]}</span>
                {kind === 'ready' && (
                  <>
                    <span aria-hidden className="text-space/50">·</span>
                    <span className="font-semibold">Restart</span>
                  </>
                )}
                {kind === 'downloading' && <span>{Math.round(status.percent ?? 0)}%</span>}
              </motion.button>
            </PopoverTrigger>

            <PopoverContent
              align="end"
              sideOffset={10}
              collisionPadding={8}
              onOpenAutoFocus={(event) => event.preventDefault()}
              className={cn(GLASS_SURFACE, 'w-72 rounded-xl p-3')}
            >
              <header className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-space/12 text-space ring-1 ring-space/25">
                  <CircleFadingArrowUp className="size-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 pt-px">
                  <p className="truncate text-[13px] leading-5 font-semibold tracking-tight">Vela {status.version}</p>
                  <p className="text-[12px] leading-[18px] text-muted-foreground">{description(kind, status)}</p>
                </div>
              </header>

              {kind === 'downloading' && <ProgressBar percent={status.percent ?? 0} rate={formatRate(status.bytesPerSecond)} />}

              <div className="flex items-center gap-1.5 pt-3">
                <button type="button" onClick={() => { setOpen(false); setNotesOpen(true); }} className={GHOST}>
                  <ScrollText className="size-3.5" strokeWidth={1.75} />
                  What’s new
                </button>
                {kind !== 'downloading' && (
                  <button type="button" onClick={() => { setOpen(false); setDismissed(`${status.version}:${kind}`); }} className={GHOST}>
                    Later
                  </button>
                )}
                <PrimaryAction kind={kind} status={status} act={act} />
              </div>
            </PopoverContent>
          </Popover>
        )}
      </AnimatePresence>
      {status?.version && <ReleaseNotesDialog status={status} open={notesOpen} onOpenChange={setNotesOpen} />}
    </>
  );
}

function description(kind: ChipKind, status: UpdateStatus): string {
  if (kind === 'ready') return 'Downloaded. Restart to update — your tabs come right back.';
  if (kind === 'downloading') return 'Downloading in the background…';
  if (kind === 'failed') return status.error ?? 'The download failed.';
  if (status.mode === 'install') return 'A new version is available.';
  return notifyReasonText(status);
}

function PrimaryAction({ kind, status, act }: { kind: ChipKind; status: UpdateStatus; act: (run: () => Promise<void>) => void }) {
  const api = vela().updates;
  if (kind === 'downloading') return null;
  if (kind === 'ready') {
    return (
      <button type="button" autoFocus onClick={() => act(api.install)} className={PRIMARY}>
        <RotateCw className="size-3.5" strokeWidth={2} />
        Restart
      </button>
    );
  }
  if (status.mode === 'install') {
    return (
      <button type="button" onClick={() => act(api.download)} className={PRIMARY}>
        {kind === 'failed' ? <RotateCw className="size-3.5" strokeWidth={2} /> : <ArrowDownToLine className="size-3.5" strokeWidth={2} />}
        {kind === 'failed' ? 'Retry' : 'Download'}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => act(api.openRelease)} className={PRIMARY}>
      <ExternalLink className="size-3.5" strokeWidth={2} />
      Get it
    </button>
  );
}

function ProgressBar({ percent, rate }: { percent: number; rate: string }) {
  return (
    <div className="pt-3">
      <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
        <motion.div
          className="h-full origin-left rounded-full bg-space"
          initial={false}
          animate={{ scaleX: Math.max(0.02, percent / 100) }}
          transition={spring.soft}
        />
      </div>
      <div className="flex justify-between pt-1.5 text-[11px] text-muted-foreground tabular-nums">
        <span>{Math.round(percent)}%</span>
        <span>{rate}</span>
      </div>
    </div>
  );
}
