import { useEffect } from 'react';
import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react';

interface AnimatedNumberProps {
  value: number;
  format?: (value: number) => string;
  className?: string;
}

const round = (value: number): string => String(Math.round(value));

/** Spring-interpolated number. Renders through a MotionValue, so ticking never re-renders React. */
export function AnimatedNumber({ value, format = round, className }: AnimatedNumberProps) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { stiffness: 140, damping: 26, mass: 0.9 });
  const text = useTransform(spring, (latest) => format(latest));

  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);

  return <motion.span className={className}>{text}</motion.span>;
}
