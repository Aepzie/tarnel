import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { SPACE_COLORS, type Space } from '@shared/types';
import { SPACE_HEX, settle, vela } from '@/lib/vela';
import { spring } from '@/lib/motion';
import { colorLabel } from './ColorSwatches';

/** Inline row of 8 color swatches inside a space's context submenu. Keeps the menu open on pick. */
export function SpaceColorRow({ space }: { space: Space }) {
  const ringId = useId();
  const reduce = useReducedMotion();

  return (
    <DropdownMenuPrimitive.Group aria-label="Color" className="flex items-center justify-between px-1 pb-1">
      {SPACE_COLORS.map((color) => {
        const selected = color === space.color;
        return (
          <DropdownMenuPrimitive.Item
            key={color}
            aria-label={colorLabel(color)}
            aria-checked={selected}
            role="menuitemradio"
            onSelect={(event) => {
              event.preventDefault();
              if (!selected) settle(vela().spaces.update(space.id, { color }));
            }}
            className="relative grid size-6 cursor-default place-items-center rounded-full outline-none data-[highlighted]:bg-foreground/[0.08]"
          >
            {selected && (
              <motion.span
                layoutId={`row-swatch-${ringId}`}
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: `inset 0 0 0 1.5px ${SPACE_HEX[color]}` }}
                transition={reduce ? { duration: 0 } : spring.pop}
              />
            )}
            <motion.span
              className="size-3.5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]"
              style={{ backgroundColor: SPACE_HEX[color] }}
              initial={false}
              animate={{ scale: selected ? 0.86 : 1 }}
              transition={reduce ? { duration: 0 } : spring.pop}
            />
          </DropdownMenuPrimitive.Item>
        );
      })}
    </DropdownMenuPrimitive.Group>
  );
}
