import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, Cpu, Leaf, MemoryStick, Moon, ShieldBan, Zap, type LucideIcon } from 'lucide-react';
import type { MemorySaverMode, PerfStats } from '@shared/types';
import type { BatterySaverMode } from '@shared/battery';
import { rise } from '@/lib/motion';
import { formatBytesMB, formatCount, velaPages } from '@/lib/vela';
import { AnimatedNumber } from '../components/brand';
import { Segmented, type SegmentOption } from '../components/controls';
import { FrameRateGroup } from '../components/frame-rate';
import { Group, Row, SectionHeader, SwitchRow } from '../components/layout';
import { hasBridge, useSettings } from '../store';

const SLEEP_OPTIONS: readonly SegmentOption<string>[] = [
  { value: '0', label: 'Never' },
  { value: '5', label: '5 min' },
  { value: '10', label: '10 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '60 min' },
];

const FREEZE_OPTIONS: readonly SegmentOption<string>[] = [
  { value: '0', label: 'Never' },
  { value: '1', label: '1 min' },
  { value: '2', label: '2 min' },
  { value: '5', label: '5 min' },
];

const SAVER_OPTIONS: readonly SegmentOption<MemorySaverMode>[] = [
  { value: 'off', label: 'Off' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'maximum', label: 'Maximum' },
];

const BATTERY_OPTIONS: readonly SegmentOption<BatterySaverMode>[] = [
  { value: 'off', label: 'Off' },
  { value: 'battery', label: 'On battery' },
  { value: 'low', label: 'Below 20 %' },
  { value: 'always', label: 'Always' },
];

const THRESHOLD_OPTIONS: readonly SegmentOption<string>[] = [
  { value: '2', label: '2 GB' },
  { value: '4', label: '4 GB' },
  { value: '6', label: '6 GB' },
  { value: '8', label: '8 GB' },
];

const POLL_MS = 2000;

/** Polls perf stats every 2s, only while this section is mounted and the document is visible. */
function usePerfStats(): PerfStats | null {
  const [stats, setStats] = useState<PerfStats | null>(null);

  useEffect(() => {
    if (!hasBridge()) return;
    let alive = true;
    let inFlight = false;
    let timer: number | undefined;
    const listeners = new AbortController();

    const stop = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const tick = () => {
      stop();
      if (!alive || inFlight || document.hidden) return;
      inFlight = true;
      velaPages()
        .perf()
        .then((next) => alive && setStats(next), () => undefined)
        .finally(() => {
          inFlight = false;
          if (!alive || document.hidden) return;
          stop();
          timer = window.setTimeout(tick, POLL_MS);
        });
    };

    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : tick()), {
      signal: listeners.signal,
    });
    tick();
    return () => {
      alive = false;
      stop();
      listeners.abort();
    };
  }, []);

  return stats;
}

const formatPercent = (n: number): string => `${n.toFixed(1)}%`;
const formatWhole = (n: number): string => formatCount(Math.round(n));

interface Stat {
  key: 'totalMemoryMB' | 'cpuPercent' | 'savedMemoryMB' | 'tabsAwake' | 'tabsAsleep' | 'blockedTotal';
  label: string;
  icon: LucideIcon;
  format: (n: number) => string;
}

const STATS: readonly Stat[] = [
  { key: 'totalMemoryMB', label: 'Memory', icon: MemoryStick, format: formatBytesMB },
  { key: 'cpuPercent', label: 'CPU', icon: Cpu, format: formatPercent },
  { key: 'savedMemoryMB', label: 'Saved by sleeping', icon: Leaf, format: formatBytesMB },
  { key: 'tabsAwake', label: 'Tabs awake', icon: Zap, format: formatWhole },
  { key: 'tabsAsleep', label: 'Tabs asleep', icon: Moon, format: formatWhole },
  { key: 'blockedTotal', label: 'Requests blocked', icon: ShieldBan, format: formatWhole },
];

function LiveDot() {
  return (
    <span className="relative inline-flex size-1.5" aria-hidden>
      <span className="absolute inset-0 motion-safe:animate-ping rounded-full bg-emerald-400/60 [animation-duration:2s]" />
      <span className="relative size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
    </span>
  );
}

export function Performance() {
  const { settings, update } = useSettings();
  const stats = usePerfStats();

  return (
    <>
      <SectionHeader title="Performance" description="Keep memory low without losing your place." />
      <Group>
        <Row title="Sleep inactive tabs" description="Unload background tabs after a period of inactivity.">
          <Segmented
            label="Sleep tabs after"
            value={String(settings.sleepAfterMinutes)}
            options={SLEEP_OPTIONS}
            onChange={(value) => update({ sleepAfterMinutes: Number(value) })}
          />
        </Row>
        <Row title="Freeze background tabs" description="Pause timers and scripts in tabs you left, before they sleep. Tabs playing audio, using the mic or camera, in a call or downloading keep running.">
          <Segmented
            label="Freeze tabs after"
            value={String(settings.freezeAfterMinutes)}
            options={FREEZE_OPTIONS}
            onChange={(value) => update({ freezeAfterMinutes: Number(value) })}
          />
        </Row>
        <Row title="Memory saver" description="When Vela uses more memory than the limit, sleep the tabs you used least recently. Maximum acts sooner and on more tabs.">
          <Segmented label="Memory saver" value={settings.memorySaver} options={SAVER_OPTIONS} onChange={(value) => update({ memorySaver: value })} />
        </Row>
        {settings.memorySaver !== 'off' && (
          <Row title="Memory limit" description="Sleep background tabs when Vela uses more than this.">
            <Segmented
              label="Memory limit"
              value={String(settings.memorySaverThresholdGB)}
              options={THRESHOLD_OPTIONS}
              onChange={(value) => update({ memorySaverThresholdGB: Number(value) })}
            />
          </Row>
        )}
        <Row
          title="Battery saver"
          description="Freeze and sleep background tabs twice as fast, use the stronger memory saver, skip address-bar preloading and calm the browser's animations. Security features are never reduced."
        >
          <Segmented label="Battery saver" value={settings.batterySaver} options={BATTERY_OPTIONS} onChange={(value) => update({ batterySaver: value })} />
        </Row>
        <SwitchRow
          title="Preload pages from the address bar"
          setting="preloadPages"
          description="Fetch the suggested page while you hover or arrow to it, so it opens faster."
        />
      </Group>

      <FrameRateGroup />

      <motion.section variants={rise} className="mb-8" aria-labelledby="perf-live">
        <h2 id="perf-live" className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
          <LiveDot />
          Live
          <span className="ml-auto font-normal">Updates every 2s</span>
        </h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STATS.map(({ key, label, icon: Icon, format }) => (
            <div
              key={key}
              className="rounded-xl bg-card/50 p-4 ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]"
            >
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
                {label}
              </dt>
              <dd className="mt-2 text-2xl leading-8 font-semibold tracking-tight text-foreground">
                {stats ? <AnimatedNumber value={stats[key]} format={format} /> : <span className="text-muted-foreground/80">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      </motion.section>

      <motion.section
        variants={rise}
        className="flex gap-3 rounded-xl bg-muted/60 p-4 text-xs leading-5 text-muted-foreground ring-1 ring-border"
      >
        <Activity className="mt-0.5 size-4 shrink-0 text-space" strokeWidth={1.75} aria-hidden />
        <p>
          <span className="font-medium text-foreground">How tab sleeping works.</span> When a background tab sits
          unused for the chosen time, Vela releases its page from memory. The tab keeps its spot, title and history;
          it reloads the moment you switch back. Pinned tabs and tabs playing audio never sleep.
        </p>
      </motion.section>
    </>
  );
}
