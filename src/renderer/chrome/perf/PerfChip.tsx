import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Activity, Check, Cpu, Gauge, Layers, Leaf, Moon, Settings2, ShieldCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useOverlayPresence } from '@/hooks/overlay';
import { shallowEqual, useBrowserSlice, usePerf } from '@/hooks/browser';
import { formatBytesMB, formatCount, settle, vela } from '@/lib/vela';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { GLASS_SURFACE } from '../spaces/surface';
import { taskManager } from '../task-manager/task-manager-store';
import { AnimatedNumber } from './AnimatedNumber';
import { SPARK_SAMPLES, Sparkline } from './Sparkline';

/** Live while the popover is open; the resting chip only needs a slow refresh. */
const POLL_OPEN_MS = 3000;
const POLL_IDLE_MS = 10_000;
const HEAVY_MB = 2048;
const SPARK_WIDTH = 264;
const SPARK_HEIGHT = 56;

const formatPercent = (value: number): string => `${Math.round(value)}%`;

/** Right-side island chip: live memory readout; opens a glass popover with stats, sparkline and actions. */
export function PerfChip() {
  const [open, setOpen] = useState(false);
  const stats = usePerf(open ? POLL_OPEN_MS : POLL_IDLE_MS);
  const reduce = useReducedMotion();
  const [samples, setSamples] = useState<number[]>([]);
  const [slept, setSlept] = useState<number | null>(null);
  useOverlayPresence(open);

  useEffect(() => {
    if (!stats) return;
    setSamples((prev) => [...prev, stats.totalMemoryMB].slice(-SPARK_SAMPLES));
  }, [stats]);

  useEffect(() => {
    if (slept === null) return;
    const timer = window.setTimeout(() => setSlept(null), 1800);
    return () => window.clearTimeout(timer);
  }, [slept]);

  /** Awake background tabs of the active space. Audible tabs are spared (sleeping kills playback). */
  const sleepable = useBrowserSlice(
    (s) => s.tabs.filter((tab) => tab.spaceId === s.activeSpaceId && tab.id !== s.activeTabId && !tab.asleep && !tab.audible).map((tab) => tab.id),
    shallowEqual,
  );

  const memory = stats?.totalMemoryMB ?? 0;
  const heavy = memory > HEAVY_MB;

  const sleepInactive = async (): Promise<void> => {
    const ids = sleepable;
    if (ids.length === 0) return;
    await Promise.allSettled(ids.map((id) => vela().tabs.sleep(id)));
    setSlept(ids.length);
  };

  const openSettings = (): void => {
    setOpen(false);
    settle(vela().tabs.create({ url: 'vela://settings/#performance', active: true }));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          whileTap={reduce ? undefined : { scale: 0.96 }}
          transition={spring.snappy}
          aria-label={stats ? `Memory ${formatBytesMB(memory)}. Performance details` : 'Performance details'}
          className={cn(
            'no-drag group/perf flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-medium tracking-tight tabular-nums',
            'transition-colors duration-300 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent',
            heavy
              ? 'text-amber-600 hover:text-amber-700 dark:text-amber-300/90 dark:hover:text-amber-200'
              : 'text-muted-foreground hover:text-foreground data-[state=open]:text-foreground',
          )}
        >
          <span className="relative grid size-4 place-items-center">
            <Gauge className="size-[15px]" strokeWidth={1.75} />
            <AnimatePresence>
              {heavy && (
                <motion.span
                  key="heavy"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={reduce ? { duration: 0 } : spring.pop}
                  className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500 ring-2 ring-[var(--island)] dark:bg-amber-400"
                />
              )}
            </AnimatePresence>
          </span>
          {stats ? (
            <AnimatedNumber value={memory} format={formatBytesMB} />
          ) : (
            <span className="h-3 w-12 animate-pulse rounded-full bg-foreground/10" aria-hidden />
          )}
        </motion.button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(GLASS_SURFACE, 'w-72 rounded-xl p-3')}
      >
        <header className="flex items-center justify-between pb-3">
          <span className="text-[13px] font-medium tracking-tight">Performance</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="relative grid size-1.5 place-items-center">
              {!reduce && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60" />}
              <span className="relative size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            </span>
            Live
          </span>
        </header>

        <section className="relative overflow-hidden rounded-[10px] bg-muted px-3 pt-2.5 ring-1 ring-border/60">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">Memory</span>
            {heavy && (
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-300/90">High usage</span>
            )}
          </div>
          <AnimatedNumber
            value={memory}
            format={formatBytesMB}
            className="block pt-0.5 text-[26px] leading-8 font-semibold tracking-tight tabular-nums"
          />
          <div className="-mx-3 pt-1">
            <Sparkline samples={samples} width={SPARK_WIDTH} height={SPARK_HEIGHT} className="block" />
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <Stat icon={<Cpu />} label="CPU">
            <AnimatedNumber value={stats?.cpuPercent ?? 0} format={formatPercent} />
          </Stat>
          <Stat icon={<Layers />} label="Tabs awake">
            <AnimatedNumber value={stats?.tabsAwake ?? 0} />
            <span className="pl-1.5 text-[12px] font-medium text-muted-foreground">
              · <AnimatedNumber value={stats?.tabsAsleep ?? 0} /> asleep
            </span>
          </Stat>
          <Stat icon={<Leaf />} label="Saved by sleep">
            <AnimatedNumber value={stats?.savedMemoryMB ?? 0} format={formatBytesMB} />
          </Stat>
          <Stat icon={<ShieldCheck />} label="Blocked">
            <AnimatedNumber value={stats?.blockedTotal ?? 0} format={(n) => formatCount(Math.round(n))} />
          </Stat>
        </div>

        <div className="flex items-center gap-2 pt-3">
          <button
            type="button"
            disabled={sleepable.length === 0 && slept === null}
            onClick={() => void sleepInactive()}
            className={cn(
              'relative flex h-8 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-[10px] bg-secondary px-2.5 text-[12px] font-medium',
              'transition-[background-color,transform,opacity] duration-150 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:opacity-50',
            )}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={slept === null ? 'idle' : 'done'}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                transition={reduce ? { duration: 0 } : { y: spring.snappy, opacity: { duration: 0.14, ease: ease.out } }}
                className="flex items-center gap-1.5"
              >
                {slept === null ? (
                  <>
                    <Moon className="size-3.5" strokeWidth={1.75} />
                    Sleep inactive
                    {sleepable.length > 0 && (
                      <span className="rounded-full bg-foreground/10 px-1.5 text-[10px] leading-4 tabular-nums">
                        {sleepable.length}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2.25} />
                    Slept {slept} {slept === 1 ? 'tab' : 'tabs'}
                  </>
                )}
              </motion.span>
            </AnimatePresence>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              taskManager.open();
            }}
            aria-label="Open task manager"
            title="Task manager (Shift Esc)"
            className="grid size-8 place-items-center rounded-[10px] text-muted-foreground transition-[background-color,color,transform] duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]"
          >
            <Activity className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={openSettings}
            aria-label="Open performance settings"
            className="flex h-8 items-center justify-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]"
          >
            <Settings2 className="size-3.5" strokeWidth={1.75} />
            Settings
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Stat({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[10px] bg-muted px-3 py-2.5 ring-1 ring-border/60">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="truncate text-[15px] leading-5 font-semibold tracking-tight tabular-nums">{children}</span>
    </div>
  );
}
