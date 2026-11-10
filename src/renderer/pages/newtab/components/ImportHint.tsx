import { motion } from 'motion/react';
import { Import, X } from 'lucide-react';
import { ease } from '@/lib/motion';
import { velaPages } from '@/lib/vela';

/** First-run nudge (fresh profile, no top sites yet): "Import from Chrome", dismissible for good. */
export function ImportHint({ browserName, onDismiss }: { browserName: string; onDismiss: () => void }) {
  const dismiss = () => {
    onDismiss();
    velaPages().browserImport.dismissHint().catch(() => undefined);
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: ease.out, delay: 0.2 } }}
      className="flex h-7 items-center rounded-full bg-island text-[11.5px] font-medium tracking-tight text-muted-foreground shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight)]"
    >
      <button
        type="button"
        onClick={() => velaPages().navigate('vela://settings/#import').catch(() => undefined)}
        className="flex h-full items-center gap-1.5 rounded-l-full pr-2 pl-2.5 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Import size={13} strokeWidth={1.75} className="text-space" aria-hidden="true" />
        Import from {browserName}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss import suggestion"
        className="grid h-full place-items-center rounded-r-full pr-2 pl-1 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </motion.div>
  );
}
