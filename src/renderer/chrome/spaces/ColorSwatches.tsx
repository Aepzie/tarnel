import { useId, useRef, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { SPACE_COLORS, type SpaceColor } from '@shared/types';
import { SPACE_HEX } from '@/lib/vela';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';

export const colorLabel = (color: SpaceColor): string => color[0]!.toUpperCase() + color.slice(1);

interface ColorSwatchesProps {
  value: SpaceColor;
  onChange: (color: SpaceColor) => void;
  className?: string;
}

/** Radio row of the 8 Space colors. Selection ring glides between swatches (shared layoutId). */
export function ColorSwatches({ value, onChange, className }: ColorSwatchesProps) {
  const ringId = useId();
  const reduce = useReducedMotion();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = SPACE_COLORS[(SPACE_COLORS.indexOf(value) + step + SPACE_COLORS.length) % SPACE_COLORS.length]!;
    onChange(next);
    refs.current[SPACE_COLORS.indexOf(next)]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Color" className={cn('flex items-center gap-2', className)} onKeyDown={onKeyDown}>
      {SPACE_COLORS.map((color, index) => {
        const selected = color === value;
        return (
          <button
            key={color}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={colorLabel(color)}
            title={colorLabel(color)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(color)}
            className="group relative grid size-7 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {selected && (
              <motion.span
                layoutId={`swatch-ring-${ringId}`}
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: `inset 0 0 0 2px ${SPACE_HEX[color]}` }}
                transition={reduce ? { duration: 0 } : spring.pop}
              />
            )}
            <motion.span
              className="size-4 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]"
              style={{ backgroundColor: SPACE_HEX[color] }}
              initial={false}
              animate={{ scale: selected ? 1 : 0.86 }}
              whileHover={reduce ? undefined : { scale: selected ? 1.06 : 0.96 }}
              whileTap={reduce ? undefined : { scale: 0.8 }}
              transition={reduce ? { duration: 0 } : spring.pop}
            />
          </button>
        );
      })}
    </div>
  );
}
