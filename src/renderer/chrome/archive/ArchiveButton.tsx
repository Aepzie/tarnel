import { motion, type Transition } from 'motion/react';
import { ArchiveIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tabArchive, useArchiveSnapshot } from './archive-store';

interface ArchiveButtonProps {
  layoutTransition: Transition;
  /** Vertical list row (label next to the icon) instead of a strip icon. */
  row?: boolean;
  iconOnly?: boolean;
}

/** Opens the tab archive. Only shown while the active Space has archived tabs. */
export function ArchiveButton({ layoutTransition, row = false, iconOnly = false }: ArchiveButtonProps) {
  const snapshot = useArchiveSnapshot();
  const count = snapshot?.archived.length ?? 0;
  if (count === 0) return null;
  const label = count === 1 ? '1 archived tab' : `${count} archived tabs`;
  return (
    <motion.button
      type="button"
      layout="position"
      transition={layoutTransition}
      aria-label={`Tab archive, ${label}`}
      title={row && !iconOnly ? undefined : `Tab archive · ${label}`}
      onClick={tabArchive.open}
      className={cn(
        'no-drag shrink-0 items-center rounded-[10px] text-zinc-500 outline-none transition-colors duration-150 hover:bg-accent hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] light:hover:text-zinc-900',
        row ? 'flex h-8 gap-2.5 text-[13px] tracking-tight active:scale-[0.98]' : 'inline-flex size-8 justify-center active:scale-[0.96]',
        row && (iconOnly ? 'justify-center' : 'pl-2.5'),
      )}
    >
      <ArchiveIcon className="size-4 shrink-0" strokeWidth={1.75} />
      {row && !iconOnly && 'Archive'}
      {row && !iconOnly && <span className="ml-auto pr-2.5 text-[11px] text-muted-foreground tabular-nums">{count}</span>}
    </motion.button>
  );
}
