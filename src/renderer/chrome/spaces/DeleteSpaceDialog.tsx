import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Loader2, Trash2 } from 'lucide-react';
import type { Space } from '@shared/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useOverlayPresence } from '@/hooks/overlay';
import { useBrowserSlice } from '@/hooks/browser';
import { vela } from '@/lib/vela';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ipcErrorMessage } from './CreateSpaceDialog';
import { SpaceMark } from './SpaceMark';
import { GLASS_SURFACE } from './surface';

interface DeleteSpaceDialogProps {
  space: Space | null;
  onOpenChange: (open: boolean) => void;
}

/** Small destructive confirm. Removing a space wipes its partition (cookies, cache, storage). */
export function DeleteSpaceDialog({ space, onOpenChange }: DeleteSpaceDialogProps) {
  const open = space !== null;
  useOverlayPresence(open);
  const reduce = useReducedMotion();
  const tabs = useBrowserSlice((s) => s.tabs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Keep the last space rendered while the close animation plays.
  const [shown, setShown] = useState<Space | null>(space);

  useEffect(() => {
    if (space) {
      setShown(space);
      setBusy(false);
      setError('');
    }
  }, [space]);

  const tabCount = shown ? tabs.filter((tab) => tab.spaceId === shown.id).length : 0;

  const confirm = async (): Promise<void> => {
    if (!shown || busy) return;
    setBusy(true);
    setError('');
    try {
      await vela().spaces.remove(shown.id);
      onOpenChange(false);
    } catch (err) {
      setError(ipcErrorMessage(err, 'Could not delete this Space.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        showCloseButton={false}
        className={cn(GLASS_SURFACE, 'w-[340px] max-w-[calc(100%-32px)] gap-0 rounded-2xl p-0 sm:max-w-[340px]')}
      >
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4">
          <span className="grid size-9 place-items-center rounded-[10px] bg-destructive/12 text-destructive ring-1 ring-destructive/25">
            <Trash2 className="size-4" strokeWidth={1.75} />
          </span>
          <div className="flex flex-col gap-1.5">
            <DialogTitle className="flex min-w-0 items-center gap-1.5 text-[15px] leading-5 font-semibold tracking-tight">
              <span className="shrink-0">Delete</span>
              {shown && <SpaceMark space={shown} />}
              <span className="truncate">{shown?.name}</span>
              <span className="shrink-0">?</span>
            </DialogTitle>
            <DialogDescription className="text-[12px] leading-[18px] text-muted-foreground">
              {tabCount > 0 ? `Its ${tabCount} ${tabCount === 1 ? 'tab' : 'tabs'} will close and ` : 'Its '}
              cookies, logins, cache and site storage will be permanently erased. This can't be undone.
            </DialogDescription>
          </div>
          <AnimatePresence initial={false}>
            {error && (
              <motion.p
                role="alert"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={reduce ? { duration: 0 } : spring.snappy}
                className="overflow-hidden text-[12px] leading-4 text-destructive"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/40 px-5 py-3">
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-[10px] px-3 text-[13px] font-medium text-muted-foreground transition-[color,background-color,transform] duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className="flex h-8 items-center gap-1.5 rounded-[10px] bg-destructive px-3.5 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] transition-[filter,transform] duration-150 outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-destructive/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.96] disabled:opacity-70"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />}
            Delete Space
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
