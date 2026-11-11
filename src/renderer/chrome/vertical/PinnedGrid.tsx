import { memo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { TabState } from '@shared/types';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { Favicon } from '../tabs/Favicon';
import { TabContextMenu } from '../tabs/TabContextMenu';

const PinnedTile = memo(function PinnedTile({ tab, active, reduced }: { tab: TabState; active: boolean; reduced: boolean }) {
  const label = tab.title || tab.url;
  return (
    <TabContextMenu tab={tab}>
      <motion.button
        type="button"
        layout="position"
        role="tab"
        aria-selected={active}
        aria-label={label}
        title={label}
        data-tab-id={tab.id}
        initial={reduced ? false : { opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={reduced ? { duration: 0 } : spring.snappy}
        onPointerDown={(event) => {
          if (event.button === 0 && !active) settle(vela().tabs.activate(tab.id));
        }}
        className={cn(
          'no-drag relative grid h-9 min-w-0 place-items-center rounded-[10px] outline-none',
          'bg-white/[0.035] ring-1 ring-white/[0.05] transition-colors duration-150 hover:bg-white/[0.07]',
          'light:bg-black/[0.03] light:ring-black/[0.05] light:hover:bg-black/[0.06]',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] active:scale-[0.96]',
          active &&
            'bg-white/[0.08] shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-space)_40%,transparent),0_6px_16px_-8px_color-mix(in_oklab,var(--accent-space)_50%,transparent)] light:bg-black/[0.05]',
        )}
      >
        <span className="relative inline-flex size-4 items-center justify-center">
          <Favicon src={tab.favicon} url={tab.url} title={tab.title} asleep={tab.asleep} />
          {tab.loading && (
            <span className="absolute -inset-1 animate-spin rounded-full border-[1.5px] border-transparent border-t-space [animation-duration:0.8s]" />
          )}
        </span>
        {(tab.audible || tab.muted || tab.micActive) && (
          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-space" aria-hidden="true" />
        )}
      </motion.button>
    </TabContextMenu>
  );
});

/** Pinned tabs of the vertical island: a compact grid of favicon tiles (one column when collapsed). */
export function PinnedGrid({ tabs, activeTabId }: { tabs: TabState[]; activeTabId: number | null }) {
  const reduced = !!useReducedMotion();
  return (
    <div role="tablist" aria-label="Pinned tabs" className="grid shrink-0 grid-cols-[repeat(auto-fill,minmax(min(100%,40px),1fr))] gap-1.5 p-2">
      <AnimatePresence initial={false} mode="popLayout">
        {tabs.map((tab) => (
          <PinnedTile key={tab.id} tab={tab} active={tab.id === activeTabId} reduced={reduced} />
        ))}
      </AnimatePresence>
    </div>
  );
}
