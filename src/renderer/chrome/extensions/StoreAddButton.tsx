import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Plus } from 'lucide-react';
import { storeDetailId } from '@shared/extension-catalog';
import { useActiveTab } from '@/hooks/browser';
import { spring } from '@/lib/motion';
import { settle, vela } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { IslandTooltip } from '../island/IslandTooltip';
import { useExtensions } from './extensions-store';

/**
 * "Add to Tarnel" pill while a Chrome Web Store detail page is open. The store's own "Add to Chrome"
 * button can't install into Tarnel, so this opens tarnel://extensions, which downloads the extension
 * and shows the usual permission review before anything is added.
 */
export function StoreAddButton() {
  const url = useActiveTab()?.url ?? '';
  const { extensions } = useExtensions();
  const reduce = useReducedMotion();
  const id = storeDetailId(url);
  const installed = id !== null && extensions.some((extension) => extension.id === id);

  return (
    <AnimatePresence initial={false}>
      {id && (
        <IslandTooltip label={installed ? 'Already in Tarnel' : 'Review permissions and add this extension'}>
          <motion.button
            key="store-add"
            type="button"
            layout="position"
            disabled={installed}
            onClick={() => settle(vela().tabs.create({ url: `tarnel://extensions/#install=${id}`, active: true }))}
            initial={reduce ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
            transition={spring.pop}
            className={cn(
              'no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset outline-none transition-[background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]',
              installed ? 'text-muted-foreground ring-border' : 'bg-space/15 text-foreground ring-space/40 hover:bg-space/25',
            )}
          >
            {installed ? (
              <Check className="size-3.5" strokeWidth={2} aria-hidden />
            ) : (
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            )}
            {installed ? 'In Tarnel' : 'Add to Tarnel'}
          </motion.button>
        </IslandTooltip>
      )}
    </AnimatePresence>
  );
}
