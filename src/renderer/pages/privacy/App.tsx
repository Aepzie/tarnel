import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import type { PrivacyReport } from '@shared/privacy-report';
import type { SpaceColor } from '@shared/types';
import { cn } from '@/lib/utils';
import { ease } from '@/lib/motion';
import { SPACE_HEX, settle, velaPages } from '@/lib/vela';
import { count, formatBytes, formatDuration, formatNumber, longDateOf, trend, weekdayOf } from './format';

const hasBridge = (): boolean => typeof window.velaPages !== 'undefined';

const card = 'rounded-xl bg-card/50 ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]';

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5">
      <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>
      <span className="text-[20px] leading-7 font-semibold tracking-tight tabular-nums">{value}</span>
      {note ? <span className="text-[11px] text-muted-foreground tabular-nums">{note}</span> : null}
    </div>
  );
}

const CHART_W = 560;
const CHART_H = 132;
const BAR_GAP = 8;
const LABEL_H = 18;

/** 14 days of blocked trackers: last week muted, this week in the Space accent. */
function DailyChart({ daily }: { daily: PrivacyReport['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.trackersBlocked));
  const barW = (CHART_W - BAR_GAP * (daily.length - 1)) / daily.length;
  const plotH = CHART_H - LABEL_H;
  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="h-auto w-full" role="img" aria-label="Trackers blocked per day, last 14 days">
      <line x1={0} x2={CHART_W} y1={plotH + 0.5} y2={plotH + 0.5} className="stroke-border" strokeWidth={1} />
      {daily.map((d, index) => {
        const thisWeek = index >= daily.length - 7;
        const h = d.trackersBlocked > 0 ? Math.max(2, (d.trackersBlocked / max) * (plotH - 6)) : 0;
        const x = index * (barW + BAR_GAP);
        const isToday = index === daily.length - 1;
        return (
          <g key={d.day}>
            <title>{`${weekdayOf(d.day)}, ${longDateOf(d.day)}: ${formatNumber(d.trackersBlocked)} blocked`}</title>
            <rect x={x} y={plotH - h} width={barW} height={h} rx={3} className={thisWeek ? 'fill-space' : 'fill-muted-foreground/25'} />
            <text
              x={x + barW / 2}
              y={CHART_H - 3}
              textAnchor="middle"
              className={cn('fill-muted-foreground text-[10px]', isToday && 'fill-foreground font-medium')}
            >
              {isToday ? 'Today' : weekdayOf(d.day).slice(0, 2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function BarRow({ label, sub, value, max, color }: { label: string; sub?: string | null; value: number; max: number; color?: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium">{label}</span>
          {sub ? <span className="truncate text-[11.5px] text-muted-foreground">{sub}</span> : null}
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-space/70"
            style={{ width: `${Math.max(2, (value / Math.max(1, max)) * 100)}%`, ...(color ? { backgroundColor: color } : {}) }}
          />
        </div>
      </div>
      <span className="w-14 shrink-0 text-right text-[12.5px] text-muted-foreground tabular-nums">{formatNumber(value)}</span>
    </li>
  );
}

function Section({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div className="px-1">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-[11.5px] text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">{children}</p>;
}

function ResetButton({ onReset }: { onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  return (
    <button
      type="button"
      onClick={() => {
        if (!confirming) return setConfirming(true);
        setConfirming(false);
        onReset();
      }}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-[10px] px-3 text-[12.5px] font-medium text-muted-foreground ring-1 ring-border',
        'transition-[background-color,color,transform] duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]',
        confirming && 'text-destructive hover:text-destructive',
      )}
    >
      <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
      {confirming ? 'Confirm reset' : 'Reset stats'}
    </button>
  );
}

export function App() {
  const [report, setReport] = useState<PrivacyReport | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!hasBridge()) return setFailed(true);
    velaPages()
      .privacyReport.get()
      .then((next) => {
        setReport(next);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    document.title = 'Privacy report';
    load();
    const onVisible = (): void => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const reset = useCallback(() => {
    velaPages()
      .privacyReport.reset()
      .then(load)
      .catch(() => undefined);
  }, [load]);

  const week = report?.thisWeek ?? {};
  const last = report?.lastWeek ?? {};
  const blocked = count(week, 'trackersBlocked');
  const blockedTrend = trend(blocked, count(last, 'trackersBlocked'));
  const maxDomain = report?.topDomains[0]?.count ?? 1;
  const maxCompany = report?.topCompanies[0]?.count ?? 1;
  const maxSpace = Math.max(1, ...(report?.spaces ?? []).map((s) => count(s.counts, 'trackersBlocked')));
  const fingerprinting = count(week, 'fingerprintMitigated');

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate min-h-screen bg-background text-foreground">
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-8 pt-10 pb-16">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-[11px] bg-card ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]">
                <ShieldCheck className="size-[17px] text-space" strokeWidth={1.75} />
              </span>
              <div>
                <h1 className="text-[20px] leading-tight font-semibold tracking-tight">Privacy report</h1>
                <p className="text-[12px] text-muted-foreground">Last 7 days · counted on this device only</p>
              </div>
            </div>
            {report?.since ? <ResetButton onReset={reset} /> : null}
          </header>

          {failed && <p className="text-[12.5px] text-muted-foreground">The report is unavailable right now.</p>}

          {report && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: ease.out }}
              className="flex flex-col gap-7"
            >
              <section className={cn(card, 'grid grid-cols-2 py-1 sm:grid-cols-3')}>
                <Stat label="Trackers and ads blocked" value={formatNumber(blocked)} note={blockedTrend?.label ?? `${formatNumber(count(last, 'trackersBlocked'))} last week`} />
                <Stat label="Data saved" value={`≈ ${formatBytes(count(week, 'bytesSaved'))}`} note={`${formatBytes(count(last, 'bytesSaved'))} last week`} />
                <Stat label="Time saved" value={`≈ ${formatDuration(report.timeSavedMs.thisWeek)}`} note="Estimated, see below" />
                <Stat label="Tracking parameters removed" value={formatNumber(count(week, 'paramsStripped'))} note={`${formatNumber(count(last, 'paramsStripped'))} last week`} />
                <Stat label="Cookie banners rejected" value={formatNumber(count(week, 'cookieBannersHandled'))} note={`${formatNumber(count(last, 'cookieBannersHandled'))} last week`} />
                <Stat
                  label={fingerprinting > 0 ? 'Fingerprinting mitigated' : 'Dangerous sites warned'}
                  value={formatNumber(fingerprinting > 0 ? fingerprinting : count(week, 'dangerousWarned'))}
                  note={`${formatNumber(count(last, fingerprinting > 0 ? 'fingerprintMitigated' : 'dangerousWarned'))} last week`}
                />
              </section>

              <Section title="This week vs last week" description="Trackers and ads blocked per day.">
                <div className={cn(card, 'px-4 pt-4 pb-3')}>
                  <DailyChart daily={report.daily} />
                  <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-[2px] bg-muted-foreground/25" aria-hidden />
                      Last week
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-[2px] bg-space" aria-hidden />
                      This week
                    </span>
                  </div>
                </div>
              </Section>

              <div className="grid gap-7 sm:grid-cols-2">
                <Section title="Who tried to track you" description="Tracker domains blocked most this week.">
                  <ul className={cn(card, 'py-2')}>
                    {report.topDomains.length === 0 ? (
                      <Empty>Nothing blocked yet this week.</Empty>
                    ) : (
                      report.topDomains.map((d) => <BarRow key={d.domain} label={d.domain} sub={d.company} value={d.count} max={maxDomain} />)
                    )}
                  </ul>
                </Section>
                <Section title="Companies" description="Known owners of those trackers.">
                  <ul className={cn(card, 'py-2')}>
                    {report.topCompanies.length === 0 ? (
                      <Empty>No known companies yet.</Empty>
                    ) : (
                      report.topCompanies.map((c) => (
                        <BarRow key={c.company} label={c.company} sub={`${c.domains} ${c.domains === 1 ? 'domain' : 'domains'}`} value={c.count} max={maxCompany} />
                      ))
                    )}
                  </ul>
                </Section>
              </div>

              <Section title="By Space" description="Trackers blocked this week in each Space. Burner Spaces only count towards the totals.">
                <ul className={cn(card, 'py-2')}>
                  {report.spaces.length === 0 ? (
                    <Empty>No activity this week.</Empty>
                  ) : (
                    report.spaces.map((s) => (
                      <BarRow
                        key={s.spaceId}
                        label={s.name ?? 'Space'}
                        sub={`${formatNumber(count(s.counts, 'paramsStripped') + count(s.counts, 'referrersTrimmed'))} links and referrers cleaned`}
                        value={count(s.counts, 'trackersBlocked')}
                        max={maxSpace}
                        color={s.color && s.color in SPACE_HEX ? SPACE_HEX[s.color as SpaceColor] : undefined}
                      />
                    ))
                  )}
                </ul>
              </Section>

              <footer className="flex flex-col gap-1.5 px-1 text-[11.5px] leading-relaxed text-muted-foreground">
                <p>
                  {report.since ? `Counting since ${longDateOf(report.since)}. ` : 'Nothing counted yet. '}
                  Daily totals are kept for 90 days on this device, with tracker domains only, never the pages you visited.
                  {` All time: ${formatNumber(count(report.allTime, 'trackersBlocked'))} blocked, ≈ ${formatBytes(count(report.allTime, 'bytesSaved'))} saved.`}
                </p>
                <p>
                  Estimates: data saved uses typical sizes per blocked request type (e.g. 25 KB per script, 8 KB per image). Time saved is
                  that data at 10 Mbit/s plus 5 ms per blocked request.
                </p>
                <p>
                  <button
                    type="button"
                    onClick={() => settle(velaPages().navigate('vela://settings/#privacy'))}
                    className="font-medium text-foreground/80 underline-offset-2 hover:underline"
                  >
                    Privacy settings
                  </button>
                </p>
              </footer>
            </motion.div>
          )}
        </main>
      </div>
    </MotionConfig>
  );
}
