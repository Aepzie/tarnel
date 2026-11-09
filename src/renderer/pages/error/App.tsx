import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { useEffect, useMemo, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { rise, stagger } from '@/lib/motion';
import { copyFor, isFallback, parseError } from './errors';
import { velaPages } from '@/lib/vela';
import { bootTheme, hasBridge } from './theme';

const DANGER = '#f87171';

export function App() {
  const reduced = useReducedMotion() ?? false;
  const error = useMemo(() => parseError(location.search), []);
  const copy = copyFor(error.code);
  const Icon = copy.icon;
  const target = error.target;
  const description = isFallback(copy) && error.detail ? error.detail : copy.desc;
  const tone = copy.danger ? DANGER : 'var(--accent-space)';

  useEffect(() => {
    document.title = target ? `${target.hostname} — ${copy.title}` : copy.title;
    void bootTheme();
  }, [copy.title, target]);

  const retry = (): void => {
    if (target && hasBridge()) void velaPages().navigate(target.href);
  };

  return (
    <div
      className="flex h-full items-center justify-center overflow-hidden bg-background px-6"
      style={{ '--ve-tone': tone } as CSSProperties}
    >
      <motion.main
        variants={stagger(0.05)}
        initial="hidden"
        animate="show"
        className="flex w-full max-w-md -translate-y-[4vh] flex-col items-center text-center"
      >
        <motion.div variants={rise} className="relative mb-7">
          <div aria-hidden="true" className="ve-glow pointer-events-none absolute -inset-10 rounded-full" />
          <motion.div
            animate={reduced ? undefined : { y: [0, -5, 0] }}
            transition={reduced ? undefined : { duration: 4.2, ease: 'easeInOut', repeat: 2 }}
            className="island relative flex size-16 items-center justify-center rounded-[20px]!"
          >
            <Icon size={26} strokeWidth={1.6} style={{ color: tone }} aria-hidden="true" />
          </motion.div>
        </motion.div>

        <motion.h1 variants={rise} className="text-2xl font-semibold tracking-tight text-balance text-foreground">
          {copy.title}
        </motion.h1>

        <motion.p
          variants={rise}
          className="mt-2.5 max-w-sm text-sm leading-relaxed text-pretty text-muted-foreground"
        >
          {description}
        </motion.p>

        {target && (
          <motion.p
            variants={rise}
            title={target.href}
            className="mt-5 max-w-full truncate rounded-full bg-foreground/[0.05] px-3 py-1.5 font-mono text-xs text-foreground/80 ring-1 ring-foreground/[0.07] ring-inset"
          >
            {target.href}
          </motion.p>
        )}

        <motion.div variants={rise} className="mt-7 flex items-center gap-2">
          {target && (
            <button
              type="button"
              autoFocus
              onClick={retry}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-[10px] px-4 text-[13px] font-medium tracking-tight text-zinc-950',
                'bg-space shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-space)_60%,transparent),0_8px_24px_-8px_color-mix(in_oklab,var(--accent-space)_55%,transparent),inset_0_1px_0_rgb(255_255_255/0.3)]',
                'transition-[transform,filter] duration-150 ease-out outline-none hover:brightness-110 active:scale-[0.96]',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <RotateCw size={14} strokeWidth={2} aria-hidden="true" />
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={() => history.back()}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-[10px] px-4 text-[13px] font-medium tracking-tight text-foreground',
              'bg-foreground/[0.05] ring-1 ring-foreground/[0.08] ring-inset',
              'transition-[transform,background-color] duration-150 ease-out outline-none hover:bg-foreground/[0.09] active:scale-[0.96]',
              'focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            Go back
          </button>
        </motion.div>

        <motion.p variants={rise} className="mt-8 font-mono text-[11px] tracking-wide text-muted-foreground/60">
          {error.code}
          {error.numeric ? ` (${error.numeric})` : ''}
        </motion.p>
      </motion.main>
    </div>
  );
}
