import { useId, useRef, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { SPACE_COLORS, type SpaceColor } from '@shared/types';
import { cn } from '@/lib/utils';
import { spring } from '@/lib/motion';
import { SPACE_HEX } from '@/lib/vela';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/** Single-select segmented control with a gliding highlight. Never deselects. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  /** Icon-only segments; the label shows on the active one (and as a tooltip on the rest). */
  compact?: boolean;
}) {
  const layoutId = useId();
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      value={value}
      aria-label={label}
      onValueChange={(next) => {
        if (next && next !== value) onChange(next as T);
      }}
      className="gap-1 rounded-lg bg-muted p-1 ring-1 ring-border ring-inset"
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            aria-label={option.label}
            title={compact ? option.label : undefined}
            className={cn(
              'relative h-7 min-w-0 rounded-sm px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150',
              'hover:bg-transparent hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground',
              'active:scale-[0.96] focus-visible:ring-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={spring.snappy}
                aria-hidden
                className="absolute inset-0 rounded-[inherit] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.06)] dark:bg-white/[0.09] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_1px_rgb(255_255_255/0.06)]"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {Icon && <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />}
              {(!compact || active) && option.label}
            </span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

const colorName = (color: SpaceColor): string => color[0]!.toUpperCase() + color.slice(1);

/** Radio group of the 8 space colors with roving tabindex and arrow keys. */
export function Swatches({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SpaceColor;
  onChange: (color: SpaceColor) => void;
}) {
  const layoutId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = SPACE_COLORS.length - 1;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index === last ? 0 : index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index === 0 ? last : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(SPACE_COLORS[next]!);
    buttons.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      {SPACE_COLORS.map((color, index) => {
        const selected = color === value;
        return (
          <button
            key={color}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={colorName(color)}
            title={colorName(color)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(color)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="group relative grid size-6 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {selected && (
              <motion.span
                layoutId={layoutId}
                transition={spring.pop}
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: `inset 0 0 0 1.5px ${SPACE_HEX[color]}` }}
              />
            )}
            <motion.span
              aria-hidden
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.85 }}
              animate={{ scale: selected ? 0.875 : 1 }}
              transition={spring.pop}
              className="size-4 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]"
              style={{ backgroundColor: SPACE_HEX[color] }}
            />
          </button>
        );
      })}
    </div>
  );
}
