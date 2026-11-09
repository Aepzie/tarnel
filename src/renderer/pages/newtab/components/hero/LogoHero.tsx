import { motion, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import { ease, spring } from '@/lib/motion';

const STROKES = ['M588 218 Q 352 420 300 742', 'M588 218 L 652 742', 'M300 742 Q 476 772 652 742'] as const;
const STARS = [
  { cx: 588, cy: 218, r: 26, opacity: 1 },
  { cx: 300, cy: 742, r: 26, opacity: 1 },
  { cx: 652, cy: 742, r: 26, opacity: 1 },
  { cx: 772, cy: 352, r: 13, opacity: 0.5 },
] as const;

const DRAW_DURATION = 0.9;
const DRAW_STAGGER = 0.14;
const STARS_AT = DRAW_DURATION + DRAW_STAGGER;

/** The Vela sail: strokes draw in, then the stars pop with an accent glow; a slow breathing halo behind. */
export function LogoHero() {
  const still = useReducedMotion() ?? false;
  const maskId = `vela-gaps-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <div className="vt-hero-glow" aria-hidden="true" />
        <svg
          viewBox="216 142 640 680"
          className="relative h-[152px] w-auto overflow-visible text-foreground"
          role="img"
          aria-label="Vela"
        >
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
              <rect width="1024" height="1024" fill="#fff" />
              {STARS.slice(0, 3).map((star) => (
                <circle key={`${star.cx}-${star.cy}`} cx={star.cx} cy={star.cy} r="62" fill="#000" />
              ))}
            </mask>
          </defs>
          <g
            mask={`url(#${maskId})`}
            fill="none"
            stroke="currentColor"
            strokeWidth="30"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {STROKES.map((d, index) => (
              <motion.path
                key={d}
                d={d}
                initial={still ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{
                  pathLength: { duration: DRAW_DURATION, ease: ease.inOut, delay: index * DRAW_STAGGER },
                  opacity: { duration: 0.12, delay: index * DRAW_STAGGER },
                }}
              />
            ))}
          </g>
          <g className="vt-hero-stars">
            {STARS.map((star, index) => (
              <motion.circle
                key={`${star.cx}-${star.cy}`}
                cx={star.cx}
                cy={star.cy}
                r={star.r}
                fill="var(--accent-space)"
                fillOpacity={star.opacity}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                initial={still ? false : { scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ ...spring.pop, delay: STARS_AT + index * 0.09 }}
              />
            ))}
          </g>
        </svg>
      </div>
      <motion.p
        className="mt-3 pl-[0.42em] text-[26px] leading-9 font-light tracking-[0.42em] text-foreground/80"
        initial={still ? false : { opacity: 0, y: 4, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ ...spring.soft, delay: still ? 0 : 0.55 }}
      >
        Vela
      </motion.p>
    </div>
  );
}
