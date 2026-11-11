import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RotateCcw, Search, Trash2, X } from 'lucide-react';
import { dayLabel, groupByDay, relativeAge, searchArchived, type ArchivedTab, type ClosedTabEntry } from '@shared/tab-archive';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useOverlayPresence } from '@/hooks/overlay';
import { hostOf, settle, SPACE_HEX, vela } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { GLASS_SURFACE } from '../spaces/surface';
import { Favicon } from '../tabs/Favicon';
import { ARCHIVE_TAB_SHORTCUT } from './archive-commands';
import { tabArchive, useArchiveSnapshot, useTabArchiveOpen } from './archive-store';

const ICON_BUTTON =
  'grid size-7 shrink-0 place-items-center rounded-[8px] text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';
const SECTION_LABEL = 'text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase';
const TEXT_BUTTON =
  'rounded-[6px] px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';

/** The tab archive: archived tabs of the active Space grouped by day, plus recently closed tabs. */
export function TabArchivePanel() {
  const open = useTabArchiveOpen();
  useOverlayPresence(open);
  const snapshot = useArchiveSnapshot();
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setNow(Date.now());
  }, [open]);

  const archived = useMemo(() => searchArchived(snapshot?.archived ?? [], query), [snapshot, query]);
  const closed = useMemo(() => searchArchived(snapshot?.closed ?? [], query), [snapshot, query]);
  const days = useMemo(() => groupByDay(archived, (entry) => entry.archivedAt), [archived]);
  const api = vela().tabArchive;
  const spaceId = snapshot?.spaceId;

  const restore = (ids: string[], close: boolean): void => {
    if (close) tabArchive.close();
    settle(api.restore(ids, spaceId));
  };
  const total = snapshot?.archived.length ?? 0;
  const empty = archived.length === 0 && closed.length === 0;

  return (
    <Dialog open={open} onOpenChange={tabArchive.setOpen}>
      <DialogContent
        showCloseButton={false}
        className={cn(GLASS_SURFACE, 'w-[520px] max-w-[calc(100%-32px)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[520px]')}
      >
        <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="text-[14px] leading-5 font-semibold tracking-tight">Tab archive</DialogTitle>
            <DialogDescription className="text-[11px] leading-4 text-muted-foreground">
              Tabs you left alone, kept for later · {ARCHIVE_TAB_SHORTCUT} archives the current tab
            </DialogDescription>
          </div>
          <button type="button" aria-label="Close tab archive" onClick={tabArchive.close} className={ICON_BUTTON}>
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <label className="mx-4 mb-2 flex h-8 items-center gap-2 rounded-[10px] bg-secondary px-2.5 ring-1 ring-border focus-within:ring-ring">
          <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search archive"
            aria-label="Search archive"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </label>

        <div className="max-h-[min(460px,calc(100vh-220px))] overflow-y-auto border-t border-border/60 px-1.5 py-1.5">
          {!snapshot && <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">Loading…</div>}
          {snapshot && empty && (
            <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">
              {query.trim() ? 'Nothing matches.' : 'No archived or recently closed tabs in this Space.'}
            </div>
          )}
          {days.map((day) => (
            <section key={day.key} className="pb-1">
              <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                <span className={SECTION_LABEL}>{dayLabel(day.key, now)}</span>
                <button type="button" className={TEXT_BUTTON} onClick={() => restore(day.entries.map((entry) => entry.id), false)}>
                  Restore all
                </button>
              </div>
              {day.entries.map((entry) => (
                <ArchivedRow
                  key={entry.id}
                  entry={entry}
                  now={now}
                  onRestore={() => restore([entry.id], true)}
                  onRemove={() => settle(api.remove([entry.id], spaceId))}
                />
              ))}
            </section>
          ))}
          {closed.length > 0 && (
            <section className="pb-1">
              <div className="px-2.5 pt-2 pb-1">
                <span className={SECTION_LABEL}>Recently closed</span>
              </div>
              {closed.map((entry) => (
                <ClosedRow
                  key={entry.id}
                  entry={entry}
                  now={now}
                  onReopen={() => {
                    tabArchive.close();
                    settle(api.reopenClosed(entry.id));
                  }}
                />
              ))}
            </section>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {total === 1 ? '1 archived tab' : `${total} archived tabs`}
          </span>
          <button
            type="button"
            disabled={total === 0}
            onClick={() => settle(api.clear(spaceId))}
            className="flex h-7 items-center gap-1.5 rounded-[8px] bg-secondary px-2.5 text-[12px] font-medium transition-[background-color,opacity,transform] duration-150 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} />
            Clear archive
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

interface RowShellProps {
  url: string;
  title: string;
  favicon: string | null;
  meta: string;
  dot?: string;
  label: string;
  onOpen: () => void;
  children?: ReactNode;
}

function RowShell({ url, title, favicon, meta, dot, label, onOpen, children }: RowShellProps) {
  return (
    <div className="group/row flex h-9 items-center gap-1 rounded-[8px] pr-1 transition-colors duration-100 hover:bg-accent/60">
      <button
        type="button"
        onClick={onOpen}
        title={`${label}: ${url}`}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-[8px] px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Favicon src={favicon} url={url} title={title} />
        <span className="min-w-0 flex-1 truncate text-[13px] tracking-tight">{title || hostOf(url) || url}</span>
        {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
        <span className="max-w-[40%] shrink-0 truncate text-[11px] text-muted-foreground">{meta}</span>
      </button>
      {children}
    </div>
  );
}

function ArchivedRow({ entry, now, onRestore, onRemove }: { entry: ArchivedTab; now: number; onRestore: () => void; onRemove: () => void }) {
  const host = hostOf(entry.url);
  return (
    <RowShell
      url={entry.url}
      title={entry.title}
      favicon={entry.favicon}
      meta={`${host ? `${host} · ` : ''}${relativeAge(entry.archivedAt, now)}`}
      dot={entry.group ? SPACE_HEX[entry.group.color] : undefined}
      label="Restore"
      onOpen={onRestore}
    >
      <button
        type="button"
        aria-label="Restore"
        title="Restore"
        onClick={onRestore}
        className={cn(ICON_BUTTON, 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100')}
      >
        <RotateCcw className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label="Delete from archive"
        title="Delete"
        onClick={onRemove}
        className={cn(ICON_BUTTON, 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100')}
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </RowShell>
  );
}

function ClosedRow({ entry, now, onReopen }: { entry: ClosedTabEntry; now: number; onReopen: () => void }) {
  const host = hostOf(entry.url);
  return (
    <RowShell
      url={entry.url}
      title={entry.title}
      favicon={entry.favicon}
      meta={`${host ? `${host} · ` : ''}${relativeAge(entry.closedAt, now)}`}
      label="Reopen"
      onOpen={onReopen}
    />
  );
}
