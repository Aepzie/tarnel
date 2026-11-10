import type { MouseEvent } from 'react';
import { XIcon } from 'lucide-react';
import type { TabState } from '@shared/types';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { TabAudioButton } from '../audio/TabAudioButton';
import { Favicon } from './Favicon';

/** Resting fill of the active tab in the horizontal strip; morphs into the palette via `layoutId="omnibox"`. */
export const ACTIVE_TAB_SURFACE = cn(
  'absolute inset-0 bg-white/[0.085] ring-1 ring-white/[0.07]',
  'shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_1px_color-mix(in_oklab,var(--accent-space)_18%,transparent)]',
  'light:bg-white light:ring-black/[0.07] light:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_color-mix(in_oklab,var(--accent-space)_14%,transparent)]',
);

function closeTab(tab: TabState) {
  return (event: MouseEvent): void => {
    event.stopPropagation();
    settle(vela().tabs.close(tab.id));
  };
}

function CloseButton({ tab, className }: { tab: TabState; className?: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Close tab"
      title="Close tab"
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-md text-zinc-400 transition-[opacity,background-color,color] duration-150',
        'hover:bg-white/10 hover:text-zinc-100 active:scale-[0.92]',
        'light:text-zinc-500 light:hover:bg-black/[0.07] light:hover:text-zinc-900',
        className,
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={closeTab(tab)}
    >
      <XIcon className="size-3.5" strokeWidth={2} />
    </button>
  );
}

function FaviconSlot({ tab, className }: { tab: TabState; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-4 shrink-0 items-center justify-center transition-opacity duration-150', className)}>
      <Favicon src={tab.favicon} url={tab.url} title={tab.title} asleep={tab.asleep} />
      {tab.loading && (
        <span className="absolute -inset-1 animate-spin rounded-full border-[1.5px] border-transparent border-t-space [animation-duration:0.8s]" />
      )}
    </span>
  );
}

export interface TabFaceProps {
  tab: TabState;
  active: boolean;
  /** Only the favicon fits (pinned or crowded strip). */
  iconOnly: boolean;
}

/**
 * Favicon + title + audio + close for one tab; the parent carries `group/tab`. The close button shows on
 * hover and stays visible on the active tab (Chrome-style). Icon-only active tabs swap favicon for the
 * close button on hover, except pinned ones.
 */
export function TabFace({ tab, active, iconOnly }: TabFaceProps) {
  if (iconOnly) {
    const closable = active && !tab.pinned;
    return (
      <span className="relative z-10 flex min-w-0 flex-1 items-center justify-center">
        <FaviconSlot tab={tab} className={closable ? 'group-hover/tab:opacity-0' : undefined} />
        {closable && (
          <CloseButton tab={tab} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover/tab:opacity-100" />
        )}
      </span>
    );
  }
  return (
    <span className="relative z-10 flex min-w-0 flex-1 items-center gap-2 pr-1 pl-2.5">
      <FaviconSlot tab={tab} />
      <span
        className={cn(
          'min-w-0 flex-1 overflow-hidden py-1 text-[12.5px] leading-none tracking-tight whitespace-nowrap transition-colors duration-150',
          active
            ? 'text-zinc-100 [mask-image:linear-gradient(to_right,#000_calc(100%-36px),transparent_calc(100%-20px))] light:text-zinc-900'
            : cn(
                'text-zinc-400 group-hover/tab:text-zinc-100 light:text-zinc-600 light:group-hover/tab:text-zinc-900',
                '[mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)] group-hover/tab:[mask-image:linear-gradient(to_right,#000_calc(100%-36px),transparent_calc(100%-20px))]',
                tab.asleep && 'text-zinc-500 light:text-zinc-500',
              ),
        )}
      >
        {tab.title || 'New Tab'}
      </span>
      <TabAudioButton tab={tab} className={cn('transition-[margin,background-color,color]', active ? 'mr-6' : 'group-hover/tab:mr-6')} />
      <CloseButton
        tab={tab}
        className={cn(
          'absolute top-1/2 right-1.5 -translate-y-1/2',
          active ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100 group-focus-visible/tab:opacity-100',
        )}
      />
    </span>
  );
}

/** Tooltip for a tab: title, plus host and blocked requests for the active one. */
export function tabTooltip(tab: TabState, active: boolean): string {
  const label = tab.title || tab.url || 'New Tab';
  if (!active) return label;
  const lines = [label];
  if (tab.url && !tab.url.startsWith('vela://newtab') && tab.url !== 'about:blank') lines.push(tab.url);
  if (tab.blockedCount > 0) lines.push(`${tab.blockedCount} requests blocked`);
  return lines.join('\n');
}
