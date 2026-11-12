import { motion, useReducedMotion } from 'motion/react';
import { BRAND_BODY_PATH, BRAND_CAP_PATH, BRAND_GLYPH_VIEWBOX } from '@shared/brand-mark';
import { spring } from '@/lib/motion';

const REFLECTION_AT = 0.28;

/** The Tarnel mark: the mountain rises in, then its accent reflection spreads across the water; a soft halo behind. */
export function LogoHero() {
  const still = useReducedMotion() ?? false;

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <div className="vt-hero-glow" aria-hidden="true" />
        <svg viewBox={BRAND_GLYPH_VIEWBOX} className="relative size-[148px] overflow-visible text-foreground" role="img" aria-label="Tarnel">
          <motion.path
            d={BRAND_BODY_PATH}
            fill="currentColor"
            initial={still ? false : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.soft, opacity: { duration: 0.24 } }}
          />
          <motion.path
            className="vt-hero-cap"
            d={BRAND_CAP_PATH}
            fill="var(--accent-space)"
            style={{ transformBox: 'fill-box', originX: 0.5, originY: 0 }}
            initial={still ? false : { opacity: 0, scaleX: 0.6 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ ...spring.soft, delay: REFLECTION_AT, opacity: { duration: 0.2, delay: REFLECTION_AT } }}
          />
        </svg>
      </div>
      <motion.p
        className="mt-4 pl-[0.42em] text-[26px] leading-9 font-light tracking-[0.42em] text-foreground/80"
        initial={still ? false : { opacity: 0, y: 4, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ ...spring.soft, delay: still ? 0 : 0.45 }}
      >
        Tarnel
      </motion.p>
    </div>
  );
}
