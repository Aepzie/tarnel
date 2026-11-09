import { motion, useReducedMotion } from 'motion/react';
import { Flame } from 'lucide-react';
import type { Space } from '@shared/types';
import { SPACE_HEX } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { spring } from '@/lib/motion';

interface SpaceMarkProps {
  space: Pick<Space, 'color' | 'ephemeral'>;
  /** Accent glow around the dot (trigger / active rows). */
  glow?: boolean;
  className?: string;
}

/** Space identity glyph: a color dot, or a flame for Burner spaces. Color changes crossfade. */
export function SpaceMark({ space, glow = false, className }: SpaceMarkProps) {
  const reduce = useReducedMotion();
  const hex = SPACE_HEX[space.color];
  const transition = reduce ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const };

  if (space.ephemeral) {
    return (
      <motion.span
        aria-hidden
        className={cn('relative grid size-4 shrink-0 place-items-center', className)}
        initial={false}
        animate={{ color: hex }}
        transition={transition}
      >
        {glow && (
          <motion.span
            className="absolute inset-0.5 rounded-full blur-[6px]"
            initial={false}
            animate={{ backgroundColor: hex, opacity: 0.45 }}
            transition={transition}
          />
        )}
        <Flame className="relative size-3.5" strokeWidth={2} fill="currentColor" fillOpacity={0.18} />
      </motion.span>
    );
  }

  return (
    <span aria-hidden className={cn('grid size-4 shrink-0 place-items-center', className)}>
      <motion.span
        className="block size-2 rounded-full"
        initial={false}
        animate={{
          backgroundColor: hex,
          boxShadow: glow ? `0 0 0 3px ${hex}29, 0 0 10px 1px ${hex}8c` : `0 0 0 0px ${hex}00, 0 0 0px 0px ${hex}00`,
          scale: 1,
        }}
        whileHover={reduce ? undefined : { scale: 1.15 }}
        transition={reduce ? { duration: 0 } : { ...transition, scale: spring.pop }}
      />
    </span>
  );
}
