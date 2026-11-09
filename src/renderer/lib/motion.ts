import type { Transition, Variants } from 'motion/react';

/** Shared motion language. Import these instead of inventing new curves. */
export const spring = {
  /** Layout, reorder, sliding indicators. */
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 } satisfies Transition,
  /** Islands, palette, larger surfaces. */
  soft: { type: 'spring', stiffness: 300, damping: 30 } satisfies Transition,
  /** Tiny elements: badges, dots, counters. */
  pop: { type: 'spring', stiffness: 700, damping: 30 } satisfies Transition,
} as const;

export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.18, ease: ease.out } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: ease.out } },
};

/** Popover / menu surface. */
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: -4, filter: 'blur(4px)' },
  show: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', transition: spring.soft },
  exit: { opacity: 0, scale: 0.97, y: -2, filter: 'blur(2px)', transition: { duration: 0.12, ease: ease.out } },
};

/** Staggered list container + item (new-tab tiles, palette rows, settings cards). */
export const stagger = (delay = 0.03): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: delay, delayChildren: 0.04 } },
});

export const rise: Variants = {
  hidden: { opacity: 0, y: 8, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: spring.soft },
};
