import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import { NEWTAB_HEROES, type NewtabHero } from '@shared/types';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ClockHero } from './ClockHero';
import { HERO_LABELS, nextHero } from './heroes';
import { LogoHero } from './LogoHero';
import { DateHero, GreetingHero } from './TextHeroes';

const HERO_HEIGHT = 200;
const MINIMAL_HEIGHT = 40;

function HeroContent({ hero }: { hero: NewtabHero }) {
  switch (hero) {
    case 'clock':
      return <ClockHero seconds={false} />;
    case 'clock-seconds':
      return <ClockHero seconds />;
    case 'logo':
      return <LogoHero />;
    case 'date':
      return <DateHero />;
    case 'greeting':
      return <GreetingHero />;
    case 'minimal':
      return null;
  }
}

const enterTransition: Transition = {
  ...spring.soft,
  opacity: { duration: 0.28, ease: ease.out },
  filter: { duration: 0.32, ease: ease.out },
};

/** Start-page hero; click / Enter / Space cycles the style, the dot row jumps directly. */
export function Hero({ hero, onChange }: { hero: NewtabHero | null; onChange: (hero: NewtabHero) => void }) {
  const reduced = useReducedMotion() ?? false;
  const minimal = hero === 'minimal';
  const current = hero ?? 'clock';

  return (
    <motion.div
      className="group relative w-[min(760px,92vw)]"
      initial={false}
      animate={{ height: minimal ? MINIMAL_HEIGHT : HERO_HEIGHT }}
      transition={reduced ? { duration: 0 } : spring.soft}
    >
      <motion.button
        type="button"
        data-glass-exempt=""
        aria-label="Change start page style"
        title={`${HERO_LABELS[current]} — click to change`}
        onClick={() => onChange(nextHero(current))}
        whileHover={reduced ? undefined : { scale: 1.01 }}
        whileTap={reduced ? undefined : { scale: 0.995 }}
        transition={spring.soft}
        className="absolute inset-0 cursor-pointer rounded-3xl outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--accent-space)]/40"
      >
        <AnimatePresence initial={false}>
          {hero && hero !== 'minimal' && (
            <motion.div
              key={hero}
              className="absolute inset-0 flex items-center justify-center"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, filter: 'blur(10px)' }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: 0.12 } }
                  : { opacity: 0, scale: 1.04, filter: 'blur(10px)', transition: { duration: 0.2, ease: ease.out } }
              }
              transition={reduced ? { duration: 0.15 } : enterTransition}
            >
              <HeroContent hero={hero} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
      {hero && (
        <div
          role="group"
          aria-label="Start page style"
          data-glass-exempt=""
          className={cn(
            'absolute top-full left-1/2 z-10 mt-1 flex -translate-x-1/2 items-center gap-0.5 transition-opacity duration-200',
            'group-focus-within:opacity-100 group-hover:opacity-100',
            minimal ? 'opacity-40' : 'opacity-0',
          )}
        >
          {NEWTAB_HEROES.map((option) => {
            const active = option === hero;
            return (
              <button
                key={option}
                type="button"
                aria-label={HERO_LABELS[option]}
                aria-current={active ? 'true' : undefined}
                title={HERO_LABELS[option]}
                onClick={() => {
                  if (!active) onChange(option);
                }}
                className="group/dot relative grid size-4 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-space)]/40"
              >
                <span className="size-1.5 rounded-full bg-foreground/20 transition-colors duration-150 group-hover/dot:bg-foreground/45" />
                {active && (
                  <motion.span
                    layoutId="vt-hero-dot"
                    transition={reduced ? { duration: 0 } : spring.snappy}
                    className="vt-hero-dot absolute size-2 rounded-full"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
