import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronRight, Globe, Search } from 'lucide-react';
import { spring } from '@/lib/motion';
import type { InputKind } from './input';

const ICONS = { search: Search, url: Globe, command: ChevronRight } as const;

/** Input glyph that morphs between search ↔ globe (URL) ↔ chevron (command mode). */
export function LeadingIcon({ kind }: { kind: InputKind }) {
  const reduce = useReducedMotion();
  const Icon = ICONS[kind];
  return (
    <span className="relative grid size-5 shrink-0 place-items-center text-muted-foreground" aria-hidden>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={kind}
          className="absolute inset-0 grid place-items-center"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5, rotate: -45, filter: 'blur(3px)' }}
          animate={{ opacity: 1, scale: 1, rotate: 0, filter: 'blur(0px)' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5, rotate: 45, filter: 'blur(3px)' }}
          transition={spring.pop}
        >
          <Icon
            className={kind === 'command' ? 'size-[17px] text-space' : 'size-4'}
            strokeWidth={kind === 'command' ? 2.25 : 1.75}
          />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
