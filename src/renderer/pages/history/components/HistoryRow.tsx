import { memo, useState, type MouseEvent } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import type { HistoryEntry } from '@shared/types';
import { cn } from '@/lib/utils';
import { ease, spring } from '@/lib/motion';
import { letterOf } from '@/lib/vela';
import { displayUrl, formatTime } from '../format';

interface HistoryRowProps {
  entry: HistoryEntry;
  selected: boolean;
  onOpen: (url: string) => void;
  onRemove: (url: string) => void;
  onHover: (url: string) => void;
}

function Favicon({ entry }: { entry: HistoryEntry }) {
  const [broken, setBroken] = useState(false);
  if (entry.favicon && !broken) {
    return (
      <img
        src={entry.favicon}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
        className="size-4 shrink-0 rounded-[4px] object-contain [:root.light_&]:drop-shadow-[0_0_0.6px_rgba(0,0,0,0.55)]"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[color-mix(in_oklab,var(--accent-space)_18%,transparent)] text-[9.5px] font-semibold text-space"
    >
      {letterOf(entry.url, entry.title)}
    </span>
  );
}

export const HistoryRow = memo(function HistoryRow({ entry, selected, onOpen, onRemove, onHover }: HistoryRowProps) {
  const { host, path } = displayUrl(entry.url);
  const title = entry.title || host + path;

  const open = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
    if (event.button > 1) return;
    onOpen(entry.url);
  };

  return (
    <motion.li
      layout="position"
      initial={false}
      exit={{
        opacity: 0,
        height: 0,
        transition: { height: { ...spring.snappy, delay: 0.04 }, opacity: { duration: 0.12, ease: ease.out } },
      }}
      transition={spring.snappy}
      className="overflow-hidden"
    >
      <div
        role="option"
        aria-selected={selected}
        data-url={entry.url}
        tabIndex={-1}
        title={`${entry.url}\n${entry.visits} ${entry.visits === 1 ? 'visit' : 'visits'}`}
        onMouseEnter={() => onHover(entry.url)}
        onClick={open}
        onAuxClick={open}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        className={cn(
          'group relative flex h-10 cursor-default scroll-mt-[calc(var(--header-h,0px)+44px)] scroll-mb-6 items-center gap-3 rounded-[10px] pr-1.5 pl-3 select-none',
          'transition-colors duration-150 outline-none',
          selected ? 'bg-accent/70 ring-1 ring-border' : 'hover:bg-accent/40',
        )}
      >
        <span className="w-12 shrink-0 text-[11.5px] text-muted-foreground/80 tabular-nums">{formatTime(entry.lastVisit)}</span>
        <Favicon entry={entry} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <span className="truncate text-[13px] font-medium tracking-tight text-foreground/95">{title}</span>
          <span className="shrink-0 truncate text-[12px] text-muted-foreground/80">{host}</span>
        </span>
        <button
          type="button"
          aria-label={`Remove ${title} from history`}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(entry.url);
          }}
          onAuxClick={(event) => event.stopPropagation()}
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground',
            'opacity-0 transition-[opacity,background-color,color,transform] duration-150 group-hover:opacity-100',
            'hover:bg-destructive/15 hover:text-destructive active:scale-[0.92]',
            selected && 'opacity-100',
          )}
        >
          <X className="size-[14px]" strokeWidth={1.75} />
        </button>
      </div>
    </motion.li>
  );
});
