import { useEffect } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { cn } from '@/lib/utils';
import { ease } from '@/lib/motion';

/** Vela mark: a billowing sail (curved stroke) with three trailing dots. */
export function VelaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn('size-5', className)} aria-hidden>
      <path
        d="M6 20.5C13.5 19 18.5 12.5 18.5 3.5C14 7.5 9.5 9.5 5 10"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.5" cy="14" r="1.25" fill="var(--accent-space)" />
      <circle cx="9.75" cy="14.75" r="1.25" fill="var(--accent-space)" opacity="0.7" />
      <circle cx="13" cy="13.25" r="1.25" fill="var(--accent-space)" opacity="0.45" />
    </svg>
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
