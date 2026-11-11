import { motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { ease } from '@/lib/motion';
import { velaPages } from '@/lib/vela';

/** "4,210 trackers blocked this week" — opens the privacy report (Settings → Appearance → Privacy stat). */
export function PrivacyStat({ blocked }: { blocked: number }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24, ease: ease.out, delay: 0.2 }}
      onClick={() => void velaPages().navigate('vela://privacy/')}
      className="group inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium tracking-tight text-muted-foreground/80 tabular-nums transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {`${blocked.toLocaleString('en-US')} ${blocked === 1 ? 'tracker' : 'trackers'} blocked this week`}
      <ChevronRight size={12} strokeWidth={2} aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </motion.button>
  );
}
