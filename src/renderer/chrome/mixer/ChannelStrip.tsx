import { memo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRightIcon } from 'lucide-react';
import type { MixerRouting, TabAudioSettings } from '@shared/audio-mixer';
import type { SpaceColor, TabState } from '@shared/types';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SPACE_HEX, hostOf, settle } from '@/lib/vela';
import { Favicon } from '../tabs/Favicon';
import { Fader, formatVolume } from './Fader';
import { Knob } from './Knob';
import { StereoMeter } from './LevelMeter';
import { mixerPanel, toggleSolo, updateTab } from './mixer-store';

export const formatBalance = (balance: number): string => {
  const amount = Math.round(Math.abs(balance) * 100);
  if (amount === 0) return 'Centre';
  return `${balance < 0 ? 'L' : 'R'} ${amount}`;
};

const ROUTING_NOTE: Partial<Record<MixerRouting, string>> = {
  partial: 'Volume only',
  idle: 'No sound yet',
};

interface ChannelStripProps {
  tab: TabState;
  settings: TabAudioSettings;
  routing: MixerRouting;
  spaceColor: SpaceColor | undefined;
  selected: boolean;
  soloed: boolean;
}

function StripButton({ label, pressed, tone, onClick, children }: {
  label: string;
  pressed: boolean;
  tone: 'mute' | 'solo';
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'grid h-5 w-[26px] place-items-center rounded-md text-[10.5px] font-semibold tracking-tight outline-none',
        'bg-foreground/[0.05] text-zinc-400 transition-[background-color,color,box-shadow] duration-150 hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94]',
        'light:text-zinc-600',
        pressed && tone === 'mute' && 'bg-red-400/[0.18] text-red-300 shadow-[0_0_10px_-2px_rgb(248_113_113/0.5)] hover:bg-red-400/25 hover:text-red-200 light:bg-red-500/15 light:text-red-600',
        pressed && tone === 'solo' && 'bg-amber-300/[0.18] text-amber-200 shadow-[0_0_10px_-2px_rgb(252_211_77/0.5)] hover:bg-amber-300/25 hover:text-amber-100 light:bg-amber-500/15 light:text-amber-700',
      )}
    >
      {children}
    </button>
  );
}

/**
 * One console-style channel per tab: identity, balance knob, volume fader with stereo meter,
 * mute / solo. Clicking the strip selects it for the detail pane.
 */
export const ChannelStrip = memo(function ChannelStrip({ tab, settings, routing, spaceColor, selected, soloed }: ChannelStripProps) {
  const reduce = useReducedMotion();
  const note = ROUTING_NOTE[routing];
  const name = tab.title || hostOf(tab.url) || 'Tab';

  const jump = (): void => {
    mixerPanel.close();
    settle(window.vela.tabs.activate(tab.id));
  };

  return (
    <div
      role="group"
      aria-label={`${name} channel`}
      aria-current={selected || undefined}
      onPointerDown={() => mixerPanel.select(tab.id)}
      onFocusCapture={() => mixerPanel.select(tab.id)}
      className={cn(
        'group/strip relative flex h-full w-[84px] shrink-0 flex-col items-center rounded-xl px-1.5 pt-2.5 pb-2 transition-[background-color,box-shadow] duration-200',
        selected
          ? 'bg-foreground/[0.055] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] light:bg-black/[0.04] light:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]'
          : 'hover:bg-foreground/[0.03]',
      )}
    >
      {selected && (
        <motion.span
          layoutId="mixer-strip-indicator"
          aria-hidden
          className="absolute top-0 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-space shadow-[0_0_8px_var(--accent-space)]"
          transition={reduce ? { duration: 0 } : spring.snappy}
        />
      )}

      <div className="relative">
        <span className="grid size-7 place-items-center rounded-lg bg-foreground/[0.06] ring-1 ring-foreground/[0.06] ring-inset">
          <Favicon src={tab.favicon} url={tab.url} title={tab.title} asleep={tab.asleep} />
        </span>
        {spaceColor && (
          <span
            aria-hidden
            className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full shadow-[0_0_0_2px_var(--popover)]"
            style={{ backgroundColor: SPACE_HEX[spaceColor] }}
          />
        )}
      </div>
      <button
        type="button"
        onClick={jump}
        title={`Go to ${name}`}
        aria-label={`Go to ${name}`}
        className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-md text-zinc-500 opacity-0 transition-[opacity,background-color,color] duration-150 outline-none group-hover/strip:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowUpRightIcon className="size-3.5" strokeWidth={1.75} />
      </button>

      <span className="mt-1.5 w-full truncate text-center text-[11px] leading-tight font-medium tracking-tight text-foreground/90" title={tab.title}>
        {name}
      </span>
      <span className={cn('w-full truncate text-center text-[10px] leading-tight', note ? 'text-amber-300/80 light:text-amber-600' : 'text-zinc-500')}>
        {note ?? hostOf(tab.url)}
      </span>

      <div className="mt-2.5 flex flex-col items-center gap-0.5">
        <Knob
          label={`${name} balance`}
          value={settings.balance}
          min={-1}
          max={1}
          step={0.05}
          defaultValue={0}
          bipolar
          size={30}
          format={formatBalance}
          onChange={(balance) => updateTab(tab.id, { balance })}
        />
        <span className="text-[9.5px] font-medium tracking-wide text-zinc-500 tabular-nums">{formatBalance(settings.balance).replace('Centre', 'C')}</span>
      </div>

      <div className="mt-2 flex min-h-0 w-full flex-1 items-stretch justify-center gap-1.5">
        <Fader
          label={`${name} volume`}
          value={settings.volume}
          muted={tab.muted}
          onChange={(volume) => updateTab(tab.id, { volume })}
          className="h-full"
        />
        <StereoMeter tabId={tab.id} muted={tab.muted} className="py-[7px]" />
      </div>

      <span
        className={cn(
          'mt-1.5 text-[11.5px] font-semibold tracking-tight tabular-nums',
          tab.muted ? 'text-zinc-500 line-through decoration-zinc-500/60' : settings.volume > 1 ? 'text-space' : 'text-foreground/90',
        )}
      >
        {formatVolume(settings.volume)}
      </span>

      <div className="mt-1.5 flex gap-1">
        <StripButton label={tab.muted ? `Unmute ${name}` : `Mute ${name}`} pressed={tab.muted} tone="mute" onClick={() => settle(window.vela.tabs.toggleMute(tab.id))}>
          M
        </StripButton>
        <StripButton label={soloed ? `Stop soloing ${name}` : `Solo ${name}`} pressed={soloed} tone="solo" onClick={() => toggleSolo(tab.id)}>
          S
        </StripButton>
      </div>
    </div>
  );
});
