import { useCallback, useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownToLine, ExternalLink, Loader2, RefreshCw, RotateCw, ScrollText } from 'lucide-react';
import type { UpdateStatus } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ReleaseNotesContent } from '@/components/ReleaseNotes';
import { formatRate, notifyReasonText, useUpdateStatus } from '@/hooks/updates';
import { ease, spring } from '@/lib/motion';
import { velaPages } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { Group, Row, SwitchRow } from './layout';
import { errorText, hasBridge, useSettings } from '../store';

const updatesApi = hasBridge() ? velaPages().updates : undefined;

const ACTION = 'h-8 gap-1.5 rounded-lg px-2.5 text-xs active:scale-[0.96]';

function ago(at: number | undefined): string {
  if (!at) return '';
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(at).toLocaleDateString();
}

function statusText(status: UpdateStatus): string {
  switch (status.phase) {
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return `You’re up to date · checked ${ago(status.checkedAt)}`;
    case 'available':
      return status.mode === 'install'
        ? `Version ${status.version} is available.`
        : `Version ${status.version} is available. ${notifyReasonText(status)}`;
    case 'downloading':
      return `Downloading ${status.version}…`;
    case 'ready':
      return `Version ${status.version} is ready. Restart Tarnel to finish updating.`;
    case 'error':
      return status.error ?? 'Update check failed.';
    default:
      if (status.mode === 'disabled') return 'Updates are off in development builds.';
      return status.checkedAt ? `Last checked ${ago(status.checkedAt)}` : 'Not checked yet.';
  }
}

function UpdateAction({ status, onError }: { status: UpdateStatus; onError: (message: string) => void }) {
  const api = velaPages().updates;
  const run = (task: () => Promise<void>) => () => {
    task().catch((error: unknown) => onError(errorText(error, 'Something went wrong.')));
  };

  if (status.phase === 'ready') {
    return (
      <Button type="button" size="sm" onClick={run(api.install)} className={cn(ACTION, 'font-semibold')}>
        <RotateCw className="size-3.5" strokeWidth={2} aria-hidden />
        Restart now
      </Button>
    );
  }
  if (status.phase === 'available' && status.mode === 'install') {
    return (
      <Button type="button" size="sm" onClick={run(api.download)} className={cn(ACTION, 'font-semibold')}>
        <ArrowDownToLine className="size-3.5" strokeWidth={2} aria-hidden />
        Download
      </Button>
    );
  }
  if (status.phase === 'available') {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={run(api.openRelease)} className={ACTION}>
        <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
        Release page
      </Button>
    );
  }
  const checking = status.phase === 'checking';
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={checking || status.phase === 'downloading' || status.mode === 'disabled'}
      onClick={run(api.check)}
      className={ACTION}
    >
      {checking ? (
        <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden />
      ) : (
        <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
      )}
      Check now
    </Button>
  );
}

function DownloadProgress({ status }: { status: UpdateStatus }) {
  const percent = status.percent ?? 0;
  return (
    <div className="mt-2 max-w-72">
      <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
        <motion.div
          className="h-full origin-left rounded-full bg-space"
          initial={false}
          animate={{ scaleX: Math.max(0.02, percent / 100) }}
          transition={spring.soft}
        />
      </div>
      <div className="flex justify-between pt-1 text-[11px] tabular-nums">
        <span>{Math.round(percent)}%</span>
        <span>{formatRate(status.bytesPerSecond)}</span>
      </div>
    </div>
  );
}

function NotesDialog({ status, open, onOpenChange }: { status: UpdateStatus; open: boolean; onOpenChange: (open: boolean) => void }) {
  const openLink = useCallback((url: string) => void velaPages().navigate(url), []);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[480px] max-w-[calc(100%-32px)] gap-0 rounded-2xl border-0 bg-popover p-0 ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight),0_24px_64px_-16px_rgb(0_0_0/0.5)] sm:max-w-[480px]"
      >
        <header className="flex items-center gap-3 px-5 pt-5 pb-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-space/12 text-space ring-1 ring-space/25">
            <ScrollText className="size-4" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0">
            <DialogTitle className="truncate text-[15px] leading-5 font-semibold tracking-tight">
              What’s new in Tarnel {status.version}
            </DialogTitle>
            <DialogDescription className="text-xs leading-[18px] text-muted-foreground">
              {status.releaseName && status.releaseName !== status.version ? status.releaseName : 'Release notes'}
            </DialogDescription>
          </div>
        </header>
        <div className="max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain px-5 pb-4">
          {status.releaseNotes ? (
            <ReleaseNotesContent notes={status.releaseNotes} onOpenLink={openLink} />
          ) : (
            <p className="text-[12.5px] leading-5 text-muted-foreground">No release notes were published for this version.</p>
          )}
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/40 px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => void velaPages().updates.openRelease()} className={ACTION}>
            <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
            View on GitHub
          </Button>
          <Button type="button" variant="secondary" size="sm" autoFocus onClick={() => onOpenChange(false)} className={ACTION}>
            Close
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → About: update status, "Check now", release notes and the three update toggles. */
export function UpdatesGroup() {
  const status = useUpdateStatus(updatesApi);
  const { settings, update } = useSettings();
  const [notesOpen, setNotesOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const autoDownloadId = useId();

  if (!status) return null;
  const installable = status.mode === 'install';
  const showNotes = !!status.version && ['available', 'downloading', 'ready'].includes(status.phase);

  return (
    <Group title="Updates">
      <Row
        title={`Tarnel ${status.currentVersion}`}
        description={
          <>
            <span role="status" aria-live="polite" className={cn(status.phase === 'error' && 'text-destructive')}>
              {actionError ?? statusText(status)}
            </span>
            <AnimatePresence initial={false}>
              {status.phase === 'downloading' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: ease.out }}
                >
                  <DownloadProgress status={status} />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        }
      >
        <div className="flex items-center gap-1">
          {showNotes && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setNotesOpen(true)} className={cn(ACTION, 'text-muted-foreground hover:text-foreground')}>
              <ScrollText className="size-3.5" strokeWidth={1.75} aria-hidden />
              What’s new
            </Button>
          )}
          <UpdateAction
            status={status}
            onError={(message) => {
              setActionError(message);
              window.setTimeout(() => setActionError(null), 4000);
            }}
          />
        </div>
      </Row>
      <SwitchRow
        title="Automatically check for updates"
        description="Checks GitHub shortly after startup and every 6 hours."
        setting="updateAutoCheck"
      />
      <Row
        title="Download updates automatically"
        description={installable ? 'Updates install the next time Tarnel restarts.' : notifyReasonText(status)}
        htmlFor={autoDownloadId}
        descriptionId={`${autoDownloadId}-desc`}
      >
        <Switch
          id={autoDownloadId}
          aria-describedby={`${autoDownloadId}-desc`}
          disabled={!installable}
          checked={installable && settings.updateAutoDownload}
          onCheckedChange={(checked) => update({ updateAutoDownload: checked })}
        />
      </Row>
      <SwitchRow
        title="Include pre-releases"
        description="Get beta versions early. They may be less stable."
        setting="updatePrerelease"
      />
      {status.version && <NotesDialog status={status} open={notesOpen} onOpenChange={setNotesOpen} />}
    </Group>
  );
}
