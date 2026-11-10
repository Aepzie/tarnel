import { memo, useState, type ReactNode } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { motion, useReducedMotion } from 'motion/react';
import { AppWindow, Clock, CornerDownLeft, Globe, Laptop, Search, Star } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { ease, spring } from '@/lib/motion';
import { letterOf } from '@/lib/vela';
import { cn } from '@/lib/utils';
import type { PaletteCommand } from './commands';
import { displayUrl } from './input';

export type PaletteRowModel =
  | { type: 'go'; id: string; input: string; kind: 'url' | 'search'; resolved: string | null }
  | { type: 'tab'; id: string; tabId: number; title: string; url: string; favicon: string | null }
  | { type: 'history'; id: string; title: string; url: string; /** Set for tabs open on another synced device. */ device?: string; /** A bookmark of the active Space. */ bookmark?: boolean }
  | { type: 'command'; id: string; command: PaletteCommand };

interface PaletteRowProps {
  row: PaletteRowModel;
  selected: boolean;
  /** Entrance delay (s); null = no entrance animation (row already visible / reduced motion). */
  delay: number | null;
  onRun: (row: PaletteRowModel) => void;
}

function sameRow(a: PaletteRowModel, b: PaletteRowModel): boolean {
  if (a === b) return true;
  if (a.type !== b.type || a.id !== b.id) return false;
  switch (a.type) {
    case 'go': {
      const other = b as typeof a;
      return a.input === other.input && a.kind === other.kind && a.resolved === other.resolved;
    }
    case 'tab': {
      const other = b as typeof a;
      return a.title === other.title && a.url === other.url && a.favicon === other.favicon;
    }
    case 'history': {
      const other = b as typeof a;
      return a.title === other.title && a.url === other.url && a.device === other.device && a.bookmark === other.bookmark;
    }
    case 'command': {
      const other = (b as typeof a).command;
      return a.command.title === other.title && a.command.hint === other.hint && a.command.active === other.active;
    }
  }
}

function samePaletteRowProps(a: PaletteRowProps, b: PaletteRowProps): boolean {
  return a.selected === b.selected && a.delay === b.delay && a.onRun === b.onRun && sameRow(a.row, b.row);
}

export const PaletteRow = memo(function PaletteRow({ row, selected, delay, onRun }: PaletteRowProps) {
  const reduce = useReducedMotion();
  return (
    <CommandPrimitive.Item
      value={row.id}
      onSelect={() => onRun(row)}
      className="group/row relative flex h-11 cursor-default items-center rounded-[10px] px-2.5 outline-none select-none"
    >
      {selected && (
        <motion.div
          layoutId="palette-sel"
          className="absolute inset-0 rounded-[10px] bg-foreground/[0.065] shadow-[inset_0_0_0_1px_var(--border)]"
          transition={reduce ? { duration: 0 } : spring.snappy}
        >
          <span className="absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-full bg-space" />
        </motion.div>
      )}
      <motion.div
        className="relative flex min-w-0 flex-1 items-center gap-3"
        initial={delay === null || reduce ? false : { opacity: 0, y: 6, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ ...spring.soft, delay: delay ?? 0, opacity: { duration: 0.2, ease: ease.out, delay: delay ?? 0 } }}
      >
        <RowLeading row={row} />
        <RowText row={row} />
        <RowHints row={row} selected={selected} />
      </motion.div>
    </CommandPrimitive.Item>
  );
}, samePaletteRowProps);

function IconTile({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-md ring-1 ring-border',
        accent ? 'bg-space/15 text-space' : 'bg-secondary text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function Favicon({ src, url, title }: { src: string | null; url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary ring-1 ring-border">
        <img src={src} alt="" className="size-4 rounded-[3px]" draggable={false} onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-[11px] font-semibold text-muted-foreground ring-1 ring-border">
      {letterOf(url, title)}
    </span>
  );
}

function RowLeading({ row }: { row: PaletteRowModel }) {
  const icon = 'size-3.5';
  switch (row.type) {
    case 'go':
      return (
        <IconTile accent>
          {row.kind === 'url' ? <Globe className={icon} strokeWidth={1.75} /> : <Search className={icon} strokeWidth={1.75} />}
        </IconTile>
      );
    case 'tab':
      return <Favicon src={row.favicon} url={row.url} title={row.title} />;
    case 'history':
      return <Favicon src={null} url={row.url} title={row.title} />;
    case 'command': {
      const Icon = row.command.icon;
      return (
        <IconTile>
          <Icon className={icon} strokeWidth={1.75} />
        </IconTile>
      );
    }
  }
}

function RowText({ row }: { row: PaletteRowModel }) {
  let title: ReactNode;
  let sub: ReactNode = null;
  switch (row.type) {
    case 'go':
      title =
        row.kind === 'url' ? (
          <>
            <span className="text-muted-foreground">Go to </span>
            {row.input}
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Search for </span>“{row.input}”
          </>
        );
      if (row.resolved && row.kind === 'url') sub = <UrlText url={row.resolved} />;
      break;
    case 'tab':
    case 'history':
      title = row.title || displayUrl(row.url).host;
      sub = <UrlText url={row.url} />;
      break;
    case 'command':
      title = row.command.title;
      break;
  }
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
      <span className="max-w-[70%] shrink-0 truncate text-[13px] font-medium tracking-tight text-foreground/95">{title}</span>
      {sub && <span className="min-w-0 truncate text-[12px] text-muted-foreground/80">{sub}</span>}
    </span>
  );
}

function UrlText({ url }: { url: string }) {
  const { host, path } = displayUrl(url);
  return (
    <>
      <span className="text-muted-foreground">{host}</span>
      <span className="text-muted-foreground/60">{path}</span>
    </>
  );
}

const hintKbd = 'h-5 rounded-[5px] bg-secondary px-1.5 text-[10.5px] text-muted-foreground ring-1 ring-border';

function RowHints({ row, selected }: { row: PaletteRowModel; selected: boolean }) {
  const reduce = useReducedMotion();
  const status =
    row.type === 'command' && row.command.hint ? (
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[10.5px] font-medium',
          row.command.active ? 'bg-space/15 text-space' : 'bg-secondary text-muted-foreground',
        )}
      >
        {row.command.hint}
      </span>
    ) : row.type === 'tab' ? (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <AppWindow className="size-3" strokeWidth={1.75} />
        Open tab
      </span>
    ) : row.type === 'history' && row.device ? (
      <span className="flex max-w-36 items-center gap-1 text-[11px] text-muted-foreground">
        <Laptop className="size-3 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{row.device}</span>
      </span>
    ) : row.type === 'history' && row.bookmark ? (
      <Star className="size-3 text-muted-foreground/60 group-data-[selected=true]/row:hidden" strokeWidth={1.75} />
    ) : row.type === 'history' ? (
      <Clock className="size-3 text-muted-foreground/60 group-data-[selected=true]/row:hidden" strokeWidth={1.75} />
    ) : null;

  const newTab = row.type === 'go' || row.type === 'history';
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
      {status}
      <motion.span
        className="-mr-1 flex items-center justify-end gap-1 overflow-hidden pr-1"
        initial={false}
        animate={selected ? { opacity: 1, x: 0, width: 'auto' } : { opacity: 0, x: reduce ? 0 : 4, width: 0 }}
        transition={{ duration: reduce ? 0 : 0.16, ease: ease.out }}
        aria-hidden
      >
        {row.type === 'tab' && <Kbd className={cn(hintKbd, 'text-foreground/80')}>Switch</Kbd>}
        {newTab && <Kbd className={hintKbd}>Ctrl ↵</Kbd>}
        <Kbd className={hintKbd}>
          <CornerDownLeft className="size-3" strokeWidth={2} />
        </Kbd>
      </motion.span>
    </span>
  );
}
