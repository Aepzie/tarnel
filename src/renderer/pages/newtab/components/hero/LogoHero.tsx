import { motion, useReducedMotion } from 'motion/react';
import { BRAND_BODY_PATH, BRAND_CAP_PATH, BRAND_GLYPH_VIEWBOX } from '@shared/brand-mark';
import { spring } from '@/lib/motion';

const CAP_AT = 0.28;

/** The Vela mark: the sail body rises in, then the accent cap settles onto it; a soft halo behind. */
export function LogoHero() {
  const still = useReducedMotion() ?? false;

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <div className="vt-hero-glow" aria-hidden="true" />
        <svg viewBox={BRAND_GLYPH_VIEWBOX} className="relative size-[148px] overflow-visible text-foreground" role="img" aria-label="Vela">
          <motion.path
            d={BRAND_BODY_PATH}
            fill="currentColor"
            initial={still ? false : { opacity: 0, y: 36 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.soft, opacity: { duration: 0.24 } }}
          />
          <motion.path
            className="vt-hero-cap"
            d={BRAND_CAP_PATH}
            fill="var(--accent-space)"
            initial={still ? false : { opacity: 0, y: -56 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.soft, delay: CAP_AT, opacity: { duration: 0.2, delay: CAP_AT } }}
          />
        </svg>
      </div>
      <motion.p
        className="mt-4 pl-[0.42em] text-[26px] leading-9 font-light tracking-[0.42em] text-foreground/80"
        initial={still ? false : { opacity: 0, y: 4, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ ...spring.soft, delay: still ? 0 : 0.45 }}
      >
        Vela
      </motion.p>
    </div>
  );
}
