import { useReducedMotion, motion } from 'motion/react';
import { useActiveTab } from '@/hooks/browser';
import { spring } from '@/lib/motion';
import { addressSeed } from '@/lib/vela';
import { ui, useChromeUI } from '../ui-store';
import { LoadingBar, OMNIBOX_SURFACE, OmniboxContent } from '../tabs/TabItem';

/**
 * Vertical layout: the top island keeps only navigation and this standalone omnibox. Same pill as
 * the active tab in the horizontal strip, and it morphs into the command palette (`layoutId="omnibox"`).
 */
export function OmniboxBar() {
  const tab = useActiveTab();
  const paletteOpen = useChromeUI().palette.open;
  const reduced = !!useReducedMotion();

  return (
    <div className="flex h-full min-w-0 flex-1 items-center px-1">
      {tab && (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Address: ${tab.url}`}
          data-omnibox=""
          onClick={() => ui.openPalette('current', addressSeed(tab.url))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            ui.openPalette('current', addressSeed(tab.url));
          }}
          className="no-drag relative flex h-8 min-w-0 flex-1 cursor-default items-center rounded-[10px] outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
        >
          {paletteOpen ? (
            <span className="absolute inset-0 rounded-[10px] bg-white/[0.03] ring-1 ring-white/[0.06] light:bg-black/[0.03] light:ring-black/[0.05]" />
          ) : (
            <motion.span
              layoutId="omnibox"
              transition={reduced ? { duration: 0 } : spring.snappy}
              style={{ borderRadius: 10 }}
              className={OMNIBOX_SURFACE}
            />
          )}
          <OmniboxContent tab={tab} reduced={reduced} paletteOpen={paletteOpen} />
          <LoadingBar show={tab.loading} reduced={reduced} />
        </div>
      )}
    </div>
  );
}
