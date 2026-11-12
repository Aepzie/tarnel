import { motion } from 'motion/react';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { rise, stagger } from '@/lib/motion';
import { velaPages } from '@/lib/vela';
import { bootTheme, hasBridge } from './theme';

const DANGER = '#f87171';

type Threat = 'malware' | 'phishing' | 'badware';

const COPY: Record<Threat, { title: string; desc: string }> = {
  phishing: {
    title: 'Deceptive site ahead',
    desc: 'This site is reported for phishing. It may try to trick you into entering passwords, card numbers or other personal details.',
  },
  malware: {
    title: 'Dangerous site ahead',
    desc: 'This address is reported for distributing malware. Opening it could install harmful software on your computer.',
  },
  badware: {
    title: 'Dangerous site ahead',
    desc: 'This site is reported for scams or harmful downloads. It may try to trick you into installing unwanted software or paying for fake services.',
  },
};

export interface SafetyWarning {
  threat: Threat;
  source: string;
  target: URL | null;
}

/** `tarnel://error/?threat=…&source=…&url=…` → warning params; null for ordinary error pages. */
export function parseWarning(search: string): SafetyWarning | null {
  const params = new URLSearchParams(search);
  const threat = params.get('threat');
  if (threat !== 'malware' && threat !== 'phishing' && threat !== 'badware') return null;
  let target: URL | null = null;
  try {
    const url = new URL(params.get('url') ?? '');
    if (url.protocol === 'http:' || url.protocol === 'https:') target = url;
  } catch {
    target = null;
  }
  return { threat, source: (params.get('source') ?? '').slice(0, 80), target };
}

export function Warning({ warning }: { warning: SafetyWarning }) {
  const copy = COPY[warning.threat];
  const target = warning.target;
  const [busy, setBusy] = useState(false);
  const canGoBack = useMemo(() => history.length > 1, []);

  useEffect(() => {
    document.title = copy.title;
    void bootTheme();
  }, [copy.title]);

  const backToSafety = (): void => {
    if (canGoBack) history.back();
    else if (hasBridge()) void velaPages().navigate('tarnel://newtab/');
  };

  const proceed = async (): Promise<void> => {
    if (!target || !hasBridge() || busy) return;
    setBusy(true);
    try {
      await velaPages().safety.proceed(target.href);
      await velaPages().navigate(target.href);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex h-full items-center justify-center overflow-hidden bg-background px-6"
      style={{ '--ve-tone': DANGER } as CSSProperties}
    >
      <motion.main
        variants={stagger(0.05)}
        initial="hidden"
        animate="show"
        className="flex w-full max-w-md -translate-y-[4vh] flex-col items-center text-center"
      >
        <motion.div variants={rise} className="relative mb-7">
          <div aria-hidden="true" className="ve-glow pointer-events-none absolute -inset-10 rounded-full" />
          <div className="island relative flex size-16 items-center justify-center rounded-[20px]!">
            <ShieldAlert size={26} strokeWidth={1.6} style={{ color: DANGER }} aria-hidden="true" />
          </div>
        </motion.div>

        <motion.h1 variants={rise} className="text-2xl font-semibold tracking-tight text-balance text-foreground">
          {copy.title}
        </motion.h1>

        <motion.p variants={rise} className="mt-2.5 max-w-sm text-sm leading-relaxed text-pretty text-muted-foreground">
          {copy.desc}
        </motion.p>

        {target && (
          <motion.p
            variants={rise}
            title={target.href}
            className="mt-5 max-w-full truncate rounded-full bg-foreground/[0.05] px-3 py-1.5 font-mono text-xs text-foreground/80 ring-1 ring-foreground/[0.07] ring-inset"
          >
            {target.hostname}
          </motion.p>
        )}

        <motion.div variants={rise} className="mt-7 flex items-center gap-2">
          <button
            type="button"
            autoFocus
            onClick={backToSafety}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-[10px] px-4 text-[13px] font-medium tracking-tight text-zinc-950',
              'bg-space shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-space)_60%,transparent),0_8px_24px_-8px_color-mix(in_oklab,var(--accent-space)_55%,transparent),inset_0_1px_0_rgb(255_255_255/0.3)]',
              'transition-[transform,filter] duration-150 ease-out outline-none hover:brightness-110 active:scale-[0.96]',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
            Back to safety
          </button>
        </motion.div>

        {target && (
          <motion.button
            variants={rise}
            type="button"
            disabled={busy}
            onClick={() => void proceed()}
            className="mt-5 rounded-md px-2 py-1 text-xs text-muted-foreground/70 underline-offset-4 outline-none transition-colors duration-150 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            Proceed anyway (unsafe)
          </motion.button>
        )}

        {warning.source && (
          <motion.p variants={rise} className="mt-8 font-mono text-[11px] tracking-wide text-muted-foreground/60">
            Listed by {warning.source}
          </motion.p>
        )}
      </motion.main>
    </div>
  );
}
