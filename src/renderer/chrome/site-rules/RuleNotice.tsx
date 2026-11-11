import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Workflow } from 'lucide-react';
import type { SiteRuleNotice } from '@shared/site-rules';
import { ease } from '@/lib/motion';

const VISIBLE_MS = 5000;

/**
 * Short hint when a site rule could not fully apply (VPN while signed out, blocked site). It sits in
 * the top island's band, so it never needs the page overlay and never blocks the page.
 */
export function RuleNotice() {
  const [notice, setNotice] = useState<(SiteRuleNotice & { key: number }) | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    let key = 0;
    return window.vela.siteRules.onNotice((next) => {
      key += 1;
      setNotice({ ...next, key });
    });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[110] flex justify-center px-4">
      <AnimatePresence>
        {notice && (
          <motion.button
            key={notice.key}
            type="button"
            role="status"
            aria-live="polite"
            onClick={() => setNotice(null)}
            initial={{ opacity: 0, y: reduce ? 0 : -4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: ease.out } }}
            exit={{ opacity: 0, transition: { duration: 0.15, ease: ease.out } }}
            className="pointer-events-auto flex h-7 max-w-[min(36rem,100%)] items-center gap-2 rounded-full bg-popover px-3 text-[12px] text-popover-foreground ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)] [-webkit-app-region:no-drag]"
          >
            <Workflow className="size-3.5 shrink-0 text-space" strokeWidth={1.75} aria-hidden />
            <span className="truncate">{notice.message}</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
