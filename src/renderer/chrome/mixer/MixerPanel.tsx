import { useEffect, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { SlidersVerticalIcon } from 'lucide-react';
import { DEFAULT_TAB_AUDIO } from '@shared/audio-mixer';
import { useBrowserState } from '@/hooks/browser';
import { ease } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ChannelStrip } from './ChannelStrip';
import { watchLevels } from './levels';
import { channelTabs, forgetSolo, mixerApi, mixerPanel, useMixer } from './mixer-store';
import { TabDetail } from './TabDetail';
import { MIXER_SHORTCUT } from './mixer-commands';

/** Below this window width the strips stack above the detail pane. */
const COMPACT_BELOW = 760;

function subscribeResize(callback: () => void): () => void {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}

function useCompact(): boolean {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth < COMPACT_BELOW);
}

function EmptyState() {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-col items-center px-8 pt-7 pb-8 text-center">
      <svg aria-hidden width="120" height="36" viewBox="0 0 120 36" className="overflow-visible">
        <motion.path
          d="M2 18 C 14 18, 18 8, 30 8 S 46 28, 60 28 S 76 8, 90 8 S 106 18, 118 18"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          className="stroke-foreground/15"
          initial={reduce ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.9, ease: ease.out }}
        />
        <line x1="2" x2="118" y1="18" y2="18" strokeDasharray="2 5" strokeWidth={1} className="stroke-foreground/15" />
      </svg>
      <p className="mt-4 text-[13px] font-semibold tracking-tight text-foreground">Nothing is playing</p>
      <p className="mt-1 max-w-[250px] text-[12px] leading-snug text-zinc-500">
        Tabs that play sound show up here with their own volume, equalizer, bass and devices.
      </p>
    </div>
  );
}

/** Mixer popover content: header, channel strips, and the selected channel's detail pane. */
export function MixerPanel() {
  const mixer = useMixer();
  const state = useBrowserState();
  const compact = useCompact();
  const channels = channelTabs(state, mixer);
  const selected =
    channels.find((tab) => tab.id === mixer.selectedId) ??
    channels.find((tab) => tab.id === state.activeTabId) ??
    channels[0];
  const spaces = new Map(state.spaces.map((space) => [space.id, space.color]));
  const playing = channels.filter((tab) => (tab.audible || mixer.simulated.includes(tab.id)) && !tab.muted).length;

  useEffect(() => {
    mixerPanel.refresh();
  }, []);

  useEffect(() => {
    const api = mixerApi();
    if (!mixer.ready || !api) return;
    return watchLevels(api);
  }, [mixer.ready, mixer.mock]);

  const soloGone = mixer.soloId !== null && !state.tabs.some((tab) => tab.id === mixer.soloId);
  useEffect(() => {
    if (soloGone) forgetSolo();
  }, [soloGone]);

  const subtitle = channels.length === 0 ? 'Per-tab sound' : playing > 0 ? `${playing} playing` : `${channels.length} ${channels.length === 1 ? 'tab' : 'tabs'}`;
  const selectedState = selected ? mixer.tabs.get(selected.id) : undefined;

  return (
    <div className={cn('flex max-h-[min(700px,calc(100vh-72px))] flex-col', channels.length === 0 && 'w-[340px]')}>
      <header className="flex h-11 shrink-0 items-center gap-2.5 px-3.5">
        <span className="grid size-6 place-items-center rounded-md bg-space/15 text-space">
          <SlidersVerticalIcon className="size-3.5" strokeWidth={2} />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-foreground">Mixer</span>
        <span className="text-[12px] text-zinc-500 tabular-nums">{subtitle}</span>
        <span className="ml-auto flex items-center gap-2">
          {mixer.mock && (
            <span title="No mixer engine in this build: levels are simulated" className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10.5px] font-medium text-zinc-400">
              Simulated
            </span>
          )}
          {playing > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="relative grid size-1.5 place-items-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-space/60 motion-reduce:hidden" />
                <span className="relative size-1.5 rounded-full bg-space" />
              </span>
              Live
            </span>
          )}
          <kbd className="hidden h-5 items-center rounded-md bg-foreground/[0.06] px-1.5 font-sans text-[10.5px] text-zinc-500 sm:flex">{MIXER_SHORTCUT}</kbd>
        </span>
      </header>
      <div className="mx-3 h-px shrink-0 bg-border" />

      {channels.length === 0 || !selected ? (
        <EmptyState />
      ) : (
        <div className={cn('flex min-h-0 flex-1', compact ? 'flex-col overflow-y-auto overscroll-contain' : 'flex-row')}>
          <div
            role="list"
            aria-label="Tabs with sound"
            className={cn(
              'flex shrink-0 gap-1 overflow-x-auto overscroll-contain p-2 [scrollbar-width:thin]',
              compact ? 'h-[318px] w-full' : 'max-w-[380px] min-w-[100px]',
            )}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {channels.map((tab) => {
                const entry = mixer.tabs.get(tab.id);
                return (
                  <motion.div
                    key={tab.id}
                    role="listitem"
                    layout="position"
                    className="h-full"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.18, ease: ease.out }}
                  >
                    <ChannelStrip
                      tab={tab}
                      settings={entry?.settings ?? DEFAULT_TAB_AUDIO}
                      routing={entry?.routing ?? 'idle'}
                      spaceColor={spaces.get(tab.spaceId)}
                      selected={tab.id === selected.id}
                      soloed={mixer.soloId === tab.id}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
          <div aria-hidden className={cn('shrink-0 bg-border', compact ? 'mx-3 h-px' : 'my-3 w-px')} />
          <div className={cn('min-w-0 p-3.5', compact ? 'w-full' : 'w-[460px] overflow-y-auto overscroll-contain [scrollbar-width:thin]')}>
            <TabDetail tab={selected} settings={selectedState?.settings ?? DEFAULT_TAB_AUDIO} routing={selectedState?.routing ?? 'idle'} />
          </div>
        </div>
      )}
    </div>
  );
}
