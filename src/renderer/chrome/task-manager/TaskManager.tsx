import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AppWindow, ArrowDown, ArrowUp, Box, Globe, Monitor, Moon, Network, PanelTop, Puzzle, SquareArrowOutUpRight, Volume2, X, Zap } from 'lucide-react';
import { sortTaskRows, type TaskRow, type TaskSnapshot, type TaskSortKey, type TaskTabState } from '@shared/task-manager';
import type { UICommand } from '@shared/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useCommand } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { formatBytesMB, settle, SPACE_HEX, vela } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { GLASS_SURFACE } from '../spaces/surface';
import { TASK_MANAGER_SHORTCUT } from './task-manager-commands';
import { taskManager, useTaskManagerOpen } from './task-manager-store';

const POLL_MS = 1000;

const STATE_LABEL: Record<TaskTabState, string> = {
  active: 'Active',
  audible: 'Playing',
  background: 'Background',
  asleep: 'Asleep',
  crashed: 'Crashed',
};

function kindIcon(row: TaskRow): LucideIcon {
  switch (row.kind) {
    case 'tab':
      return Globe;
    case 'extension':
      return Puzzle;
    case 'browser':
      return AppWindow;
    case 'gpu':
      return Monitor;
    case 'interface':
      return PanelTop;
    case 'renderer':
      return Box;
    default:
      if (/network/i.test(row.title)) return Network;
      if (/audio/i.test(row.title)) return Volume2;
      return Box;
  }
}

const formatCpu = (value: number | null): string => (value === null ? '–' : value.toFixed(1));
const formatMemory = (value: number | null): string => (value === null ? '–' : formatBytesMB(value));

/** Polls a snapshot every second while `open`; nothing runs while the panel is closed. */
function useTaskSnapshot(open: boolean): [TaskSnapshot | null, () => void] {
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const tick = (): void => {
      vela()
        .taskManager.snapshot()
        .then((next) => alive && setSnapshot(next))
        .catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open, nonce]);
  return [snapshot, useCallback(() => setNonce((n) => n + 1), [])];
}

/** Chrome-like task manager: per tab / extension / service CPU and memory, with tab actions. */
export function TaskManager() {
  const open = useTaskManagerOpen();
  const [snapshot, refresh] = useTaskSnapshot(open);
  const [sort, setSort] = useState<{ key: TaskSortKey; descending: boolean }>({ key: 'memory', descending: true });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useOverlayPresence(open);

  const onCommand = useCallback((command: UICommand): void => {
    if (command === 'task-manager') taskManager.toggle();
  }, []);
  useCommand(onCommand);

  useEffect(() => {
    if (!open) setSelectedKey(null);
  }, [open]);

  const rows = useMemo(() => (snapshot ? sortTaskRows(snapshot.rows, sort.key, sort.descending) : []), [snapshot, sort]);
  const selected = rows.find((row) => row.key === selectedKey) ?? null;
  const selectedTab = selected?.tabId ?? null;

  const toggleSort = (key: TaskSortKey): void =>
    setSort((prev) => (prev.key === key ? { key, descending: !prev.descending } : { key, descending: key !== 'title' }));

  const goTo = (tabId: number): void => {
    taskManager.close();
    settle(vela().tabs.activate(tabId));
  };
  const act = (run: (tabId: number) => Promise<void>): void => {
    if (selectedTab === null) return;
    void run(selectedTab).finally(refresh);
  };

  return (
    <Dialog open={open} onOpenChange={taskManager.setOpen}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(GLASS_SURFACE, 'w-[640px] max-w-[calc(100%-32px)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[640px]')}
      >
        <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="text-[14px] leading-5 font-semibold tracking-tight">Task manager</DialogTitle>
            <DialogDescription className="text-[11px] leading-4 text-muted-foreground">
              Updated every second while open · {TASK_MANAGER_SHORTCUT}
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Close task manager"
            onClick={taskManager.close}
            className="grid size-7 place-items-center rounded-[8px] text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div role="table" aria-label="Processes" className="flex flex-col text-[12px]">
          <div role="row" className="grid grid-cols-[minmax(0,1fr)_88px_72px_96px] items-center gap-2 border-y border-border/60 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">
            <SortHeader label="Task" column="title" sort={sort} onSort={toggleSort} align="left" />
            <span role="columnheader">State</span>
            <SortHeader label="CPU %" column="cpu" sort={sort} onSort={toggleSort} align="right" />
            <SortHeader label="Memory" column="memory" sort={sort} onSort={toggleSort} align="right" />
          </div>
          <div role="rowgroup" className="max-h-[min(420px,calc(100vh-220px))] overflow-y-auto py-1">
            {!snapshot && <div className="px-4 py-6 text-center text-muted-foreground">Measuring…</div>}
            {rows.map((row) => (
              <Row
                key={row.key}
                row={row}
                selected={row.key === selectedKey}
                onSelect={() => setSelectedKey(row.key)}
                onOpen={row.tabId === null ? undefined : () => goTo(row.tabId as number)}
              />
            ))}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {snapshot ? (
              <>
                {snapshot.totals.processes} processes · CPU <span className="text-foreground">{snapshot.totals.cpuPercent.toFixed(1)}%</span> · Memory{' '}
                <span className="text-foreground">{formatBytesMB(snapshot.totals.memoryMB)}</span>
              </>
            ) : (
              ' '
            )}
          </span>
          <div className="flex items-center gap-1.5">
            <ActionButton icon={SquareArrowOutUpRight} label="Go to tab" disabled={selectedTab === null} onClick={() => selectedTab !== null && goTo(selectedTab)} />
            <ActionButton
              icon={Moon}
              label="Sleep"
              disabled={selectedTab === null || selected?.state === 'asleep' || selected?.state === 'active'}
              onClick={() => act((id) => vela().tabs.sleep(id))}
            />
            <ActionButton
              icon={Zap}
              label="End process"
              disabled={selectedTab === null || selected?.state === 'asleep' || selected?.state === 'crashed'}
              onClick={() => act((id) => vela().taskManager.endProcess(id))}
            />
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

interface SortHeaderProps {
  label: string;
  column: TaskSortKey;
  sort: { key: TaskSortKey; descending: boolean };
  onSort: (key: TaskSortKey) => void;
  align: 'left' | 'right';
}

function SortHeader({ label, column, sort, onSort, align }: SortHeaderProps) {
  const active = sort.key === column;
  const Arrow = sort.descending ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      role="columnheader"
      aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
      onClick={() => onSort(column)}
      className={cn(
        'flex items-center gap-1 rounded-[6px] outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        align === 'right' && 'justify-end',
        active && 'text-foreground',
      )}
    >
      {label}
      <Arrow className={cn('size-3', !active && 'invisible')} strokeWidth={2} />
    </button>
  );
}

function Row({ row, selected, onSelect, onOpen }: { row: TaskRow; selected: boolean; onSelect: () => void; onOpen?: () => void }) {
  const Icon = kindIcon(row);
  const [broken, setBroken] = useState(false);
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && onOpen) onOpen();
      }}
      className={cn(
        'mx-1.5 grid cursor-default grid-cols-[minmax(0,1fr)_88px_72px_96px] items-center gap-2 rounded-[8px] px-2.5 py-1.5 outline-none transition-colors duration-100',
        selected ? 'bg-accent' : 'hover:bg-accent/50',
        'focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span role="cell" className="flex min-w-0 items-center gap-2">
        <span className="relative grid size-4 shrink-0 place-items-center text-muted-foreground">
          {row.favicon && !broken ? (
            <img src={row.favicon} alt="" className="size-4 rounded-[3px]" onError={() => setBroken(true)} />
          ) : (
            <Icon className="size-3.5" strokeWidth={1.75} />
          )}
        </span>
        <span className={cn('truncate', row.state === 'asleep' && 'text-muted-foreground')} title={row.title}>
          {row.title}
        </span>
        {row.spaceColor && <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: SPACE_HEX[row.spaceColor] }} />}
        {row.shared && <span className="shrink-0 text-[10px] text-muted-foreground" title="Shares a process with another row">shared</span>}
      </span>
      <span role="cell" className={cn('truncate text-[11px] text-muted-foreground', row.state === 'crashed' && 'text-red-500 dark:text-red-400')}>
        {row.state ? STATE_LABEL[row.state] : row.kind === 'extension' && row.memoryMB === null ? 'Idle' : ''}
      </span>
      <span role="cell" className="text-right tabular-nums">{formatCpu(row.cpuPercent)}</span>
      <span role="cell" className="text-right tabular-nums">{formatMemory(row.memoryMB)}</span>
    </div>
  );
}

function ActionButton({ icon: Icon, label, disabled, onClick }: { icon: LucideIcon; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 items-center gap-1.5 rounded-[8px] bg-secondary px-2.5 text-[12px] font-medium transition-[background-color,opacity,transform] duration-150 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
      {label}
    </button>
  );
}
