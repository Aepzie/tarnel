import { useCallback } from 'react';
import { ExternalLink, ScrollText } from 'lucide-react';
import type { UpdateStatus } from '@shared/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ReleaseNotesContent } from '@/components/ReleaseNotes';
import { useOverlayPresence } from '@/hooks/overlay';
import { settle, vela } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { GLASS_SURFACE } from '../spaces/surface';

function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "What's new" dialog for the available/downloaded version. */
export function ReleaseNotesDialog({
  status,
  open,
  onOpenChange,
}: {
  status: UpdateStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useOverlayPresence(open);
  const date = formatDate(status.releaseDate);

  const openLink = useCallback(
    (url: string) => {
      onOpenChange(false);
      settle(vela().tabs.create({ url, active: true }));
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(GLASS_SURFACE, 'w-[440px] max-w-[calc(100%-32px)] gap-0 rounded-2xl p-0 sm:max-w-[440px]')}
      >
        <header className="flex items-center gap-3 px-5 pt-5 pb-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-space/12 text-space ring-1 ring-space/25">
            <ScrollText className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <DialogTitle className="truncate text-[15px] leading-5 font-semibold tracking-tight">
              What’s new in Vela {status.version}
            </DialogTitle>
            <DialogDescription className="text-[12px] leading-[18px] text-muted-foreground">
              {date ? `Released ${date}` : 'Release notes'}
            </DialogDescription>
          </div>
        </header>
        <div className="max-h-[min(380px,55vh)] overflow-y-auto overscroll-contain px-5 pb-4">
          {status.releaseNotes ? (
            <ReleaseNotesContent notes={status.releaseNotes} onOpenLink={openLink} />
          ) : (
            <p className="text-[12.5px] leading-5 text-muted-foreground">No release notes were published for this version.</p>
          )}
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/40 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              settle(vela().updates.openRelease());
            }}
            className="flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-medium text-muted-foreground transition-[color,background-color,transform] duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]"
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
            View on GitHub
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-[10px] bg-secondary px-3.5 text-[13px] font-medium transition-[background-color,transform] duration-150 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]"
          >
            Close
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
