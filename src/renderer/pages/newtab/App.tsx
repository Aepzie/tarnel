import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { PerfStats } from '@shared/types';
import { ease } from '@/lib/motion';
import { velaPages } from '@/lib/vela';
import { Aurora } from './components/Aurora';
import { Clock } from './components/Clock';
import { SearchBar } from './components/SearchBar';
import { StatsFooter } from './components/StatsFooter';
import { TopSites, toSites, type Site } from './components/TopSites';
import { bootTheme, hasBridge } from './theme';

export function App() {
  const [sites, setSites] = useState<Site[]>([]);
  const [stats, setStats] = useState<PerfStats | null>(null);

  useEffect(() => {
    void bootTheme();
    if (!hasBridge()) return;
    velaPages()
      .topSites()
      .then((raw) => setSites(toSites(raw)))
      .catch(() => undefined);
    velaPages()
      .perf()
      .then(setStats)
      .catch(() => undefined);
  }, []);

  return (
    <div className="relative h-full overflow-hidden bg-background">
      <Aurora />
      <main className="relative z-10 flex h-full flex-col items-center justify-center px-4 pb-[6vh]">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: ease.out }}
          className="flex flex-col items-center"
        >
          <Clock />
          <div className="mt-9">
            <SearchBar />
          </div>
        </motion.div>
        <div className="mt-10 flex h-[212px] w-full items-start justify-center">
          {sites.length > 0 && <TopSites sites={sites} />}
        </div>
      </main>
      <footer className="absolute inset-x-0 bottom-5 z-10 flex justify-center px-4">
        {stats && <StatsFooter stats={stats} />}
      </footer>
    </div>
  );
}
