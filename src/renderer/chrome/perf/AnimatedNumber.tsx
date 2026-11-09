import { useEffect } from 'react';
import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react';

interface AnimatedNumberProps {
  value: number;
  format?: (value: number) => string;
  className?: string;
}

const round = (value: number): string => String(Math.round(value));

/**
 * Steps under 2% snap instead of springing: a periodic poll would otherwise run a ~1 s rAF spring
 * (and a compositor frame per tick) every few seconds for a change nobody can read mid-flight.
 */
const isSmallStep = (from: number, to: number): boolean => Math.abs(to - from) <= Math.max(Math.abs(from), Math.abs(to)) * 0.02;

/** Spring-interpolated number. Renders through a MotionValue, so ticking never re-renders React. */
export function AnimatedNumber({ value, format = round, className }: AnimatedNumberProps) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { stiffness: 140, damping: 26, mass: 0.9 });
  const text = useTransform(spring, (latest) => format(latest));

  useEffect(() => {
    if (reduce || format(spring.get()) === format(value) || isSmallStep(spring.get(), value)) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);

  return <motion.span className={className}>{text}</motion.span>;
}
