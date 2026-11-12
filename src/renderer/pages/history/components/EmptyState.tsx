import { motion } from 'motion/react';
import { History, SearchX } from 'lucide-react';
import { rise } from '@/lib/motion';

export function EmptyState({ query, error }: { query: string; error?: boolean }) {
  const searching = query.trim().length > 0;
  const Icon = searching ? SearchX : History;
  const title = error ? 'History is unavailable' : searching ? 'No matches' : 'No history yet';
  const description = error
    ? 'This page can only read history inside Tarnel.'
    : searching
      ? `Nothing you visited matches “${query.trim()}”.`
      : 'Pages you visit will show up here, grouped by day.';

  return (
    <motion.div
      key={title}
      variants={rise}
      initial="hidden"
      animate="show"
      className="flex flex-col items-center px-6 pt-24 pb-16 text-center"
    >
      <div className="relative mb-6 grid size-16 place-items-center">
        <span
          aria-hidden
          className="absolute inset-[-28px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent-space)_22%,transparent),transparent)]"
        />
        <span className="relative grid size-16 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent-space)_14%,transparent)] ring-1 ring-[color-mix(in_oklab,var(--accent-space)_30%,transparent)] shadow-[inset_0_1px_0_var(--island-highlight)]">
          <Icon className="size-7 text-space" strokeWidth={1.5} />
        </span>
      </div>
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-xs text-[13px] text-muted-foreground">{description}</p>
    </motion.div>
  );
}
