import { animate, motion, useReducedMotion } from 'motion/react';
import { Cpu, Moon, Shield, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PerfStats } from '@shared/types';
import { ease, rise, stagger } from '@/lib/motion';
import { formatBytesMB, formatCount } from '@/lib/vela';

function useCountUp(target: number, reduced: boolean): number {
  const [current, setCurrent] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setCurrent(target);
      return;
    }
    const controls = animate(0, target, {
      duration: 1.1,
      ease: ease.out,
      onUpdate: (latest) => setCurrent(latest),
    });
    return () => controls.stop();
  }, [target, reduced]);
  return current;
}

function Pill({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <motion.li
      variants={rise}
      className="flex h-7 list-none items-center gap-1.5 rounded-full bg-island pr-3 shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight)] pl-2.5 text-[11.5px] font-medium tracking-tight text-muted-foreground tabular-nums"
    >
      <Icon size={13} strokeWidth={1.75} className="text-space" aria-hidden="true" />
      {children}
    </motion.li>
  );
}

const plural = (n: number, word: string): string => `${word}${n === 1 ? '' : 's'}`;

export function StatsFooter({ stats }: { stats: PerfStats }) {
  const reduced = useReducedMotion() ?? false;
  const blocked = Math.round(useCountUp(stats.blockedTotal, reduced));
  const sleeping = Math.round(useCountUp(stats.tabsAsleep, reduced));
  const memory = useCountUp(stats.totalMemoryMB, reduced);

  return (
    <motion.ul
      variants={stagger(0.06)}
      initial="hidden"
      animate="show"
      className="flex flex-wrap items-center justify-center gap-2 p-0"
      aria-label="Browser stats"
    >
      <Pill icon={Shield}>{`${formatCount(blocked)} ${plural(stats.blockedTotal, 'tracker')} blocked`}</Pill>
      <Pill icon={Moon}>{`${sleeping} ${plural(stats.tabsAsleep, 'tab')} sleeping`}</Pill>
      <Pill icon={Cpu}>{formatBytesMB(memory)}</Pill>
    </motion.ul>
  );
}
