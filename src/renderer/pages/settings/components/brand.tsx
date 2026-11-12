import { useEffect } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { BRAND_BODY_PATH, BRAND_CAP_PATH, BRAND_GLYPH_VIEWBOX, brandIconSvg } from '@shared/brand-mark';
import { cn } from '@/lib/utils';
import { ease } from '@/lib/motion';

/** Tarnel mark (same geometry as the app icon): mountain in currentColor, reflection in the Space accent. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox={BRAND_GLYPH_VIEWBOX} className={cn('size-5', className)} aria-hidden>
      <path d={BRAND_BODY_PATH} fill="currentColor" />
      <path d={BRAND_CAP_PATH} fill="var(--accent-space)" />
    </svg>
  );
}

/** Same markup as the taskbar / installer icon, but the reflection follows the theme accent. */
const APP_ICON_SVG = brandIconSvg('square', 'var(--accent-space)');

/** The full-colour app icon, inline so its accent reflection tracks the active Space colour live. */
export function BrandAppIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('block size-16 select-none [&>svg]:size-full', className)}
      dangerouslySetInnerHTML={{ __html: APP_ICON_SVG }}
    />
  );
}

/** Number that tweens to each new value; jumps when reduced motion is requested. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(0);
  const text = useTransform(motionValue, format);

  useEffect(() => {
    if (reduce) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, { duration: 0.7, ease: ease.out });
    return () => controls.stop();
  }, [value, reduce, motionValue]);

  return <motion.span className="tabular-nums">{text}</motion.span>;
}
