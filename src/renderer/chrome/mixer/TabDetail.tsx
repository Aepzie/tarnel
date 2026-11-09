import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { InfoIcon, RotateCcwIcon } from 'lucide-react';
import { EQ_PRESETS, isNeutralAudio, type EqPresetId, type MixerRouting, type TabAudioSettings } from '@shared/audio-mixer';
import type { TabState } from '@shared/types';
import { Switch } from '@/components/ui/switch';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { hostOf } from '@/lib/vela';
import { Favicon } from '../tabs/Favicon';
import { BassBoost } from './BassBoost';
import { DevicePickers } from './DevicePickers';
import { EqGraph } from './EqGraph';
import { resetTab, settingsOf, updateTab } from './mixer-store';

const PRESET_IDS = Object.keys(EQ_PRESETS) as EqPresetId[];

const ROUTING_NOTES: Partial<Record<MixerRouting, string>> = {
  partial: 'Some audio on this page can only be adjusted in volume',
  idle: 'No sound yet · changes apply once it plays',
};

function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-between">
      <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{children}</span>
      {aside}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex min-w-0 flex-1 cursor-default items-center gap-3 rounded-lg bg-foreground/[0.035] px-3 py-2 ring-1 ring-foreground/[0.06] ring-inset">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] leading-tight font-medium tracking-tight text-foreground/90">{label}</span>
        <span className="block truncate text-[11px] leading-tight text-zinc-500">{hint}</span>
      </span>
      <Switch size="sm" checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

/** Detail pane of the selected channel: EQ, presets, bass boost, mono / compressor, devices. */
export function TabDetail({ tab, settings, routing }: { tab: TabState; settings: TabAudioSettings; routing: MixerRouting }) {
  const reduce = useReducedMotion();
  const note = ROUTING_NOTES[routing];
  const neutral = isNeutralAudio(settings) && settings.preset === 'flat';

  const setBand = (index: number, gain: number): void => {
    const bands = settingsOf(tab.id).bands.map((current, band) => (band === index ? gain : current));
    updateTab(tab.id, { bands, preset: null, eqEnabled: true });
  };

  const applyPreset = (id: EqPresetId): void => {
    const preset = EQ_PRESETS[id];
    updateTab(tab.id, {
      bands: [...preset.bands],
      preset: id,
      eqEnabled: true,
      ...(preset.bassBoost ? { bassBoost: { ...settings.bassBoost, ...preset.bassBoost } } : {}),
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex h-8 items-center gap-2.5">
        <Favicon src={tab.favicon} url={tab.url} title={tab.title} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight font-semibold tracking-tight text-foreground">{tab.title || hostOf(tab.url)}</span>
          {note ? (
            <span role="note" className="flex items-center gap-1 truncate text-[11px] leading-tight text-amber-300/85 light:text-amber-700" title={note}>
              <InfoIcon className="size-3 shrink-0" strokeWidth={2} />
              <span className="truncate">{note}</span>
            </span>
          ) : (
            <span className="block truncate text-[11px] leading-tight text-zinc-500">{hostOf(tab.url)}</span>
          )}
        </span>
        <button
          type="button"
          disabled={neutral}
          onClick={() => resetTab(tab.id)}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-zinc-400 transition-[background-color,color,opacity] duration-150 outline-none hover:bg-foreground/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 light:text-zinc-600"
        >
          <RotateCcwIcon className="size-3.5" strokeWidth={1.75} />
          Reset
        </button>
      </div>

      <div>
        <SectionLabel
          aside={
            <label className="flex cursor-default items-center gap-2 text-[11.5px] text-zinc-400 light:text-zinc-600">
              {settings.eqEnabled ? (settings.preset === null ? 'Custom' : EQ_PRESETS[settings.preset].label) : 'Off'}
              <Switch size="sm" checked={settings.eqEnabled} onCheckedChange={(eqEnabled) => updateTab(tab.id, { eqEnabled })} aria-label="Equalizer" />
            </label>
          }
        >
          Equalizer
        </SectionLabel>
        <div className="mt-1 h-[172px] rounded-xl bg-foreground/[0.025] ring-1 ring-foreground/[0.06] ring-inset">
          <EqGraph tabId={tab.id} settings={settings} onBand={setBand} live={routing === 'full'} />
        </div>
        <div role="radiogroup" aria-label="Equalizer preset" className="mt-2 flex flex-wrap gap-1">
          {PRESET_IDS.map((id) => {
            const active = settings.eqEnabled && settings.preset === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => applyPreset(id)}
                className={cn(
                  'relative h-6 rounded-full px-2.5 text-[11.5px] font-medium tracking-tight outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]',
                  active ? 'text-foreground' : 'text-zinc-400 hover:bg-foreground/[0.06] hover:text-foreground light:text-zinc-600',
                )}
              >
                {active && (
                  <motion.span
                    layoutId={`mixer-preset-${tab.id}`}
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-space/[0.16] ring-1 ring-space/40 ring-inset"
                    transition={reduce ? { duration: 0 } : spring.snappy}
                  />
                )}
                <span className="relative">{EQ_PRESETS[id].label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <BassBoost tabId={tab.id} bassBoost={settings.bassBoost} onChange={(patch) => updateTab(tab.id, { bassBoost: { ...settingsOf(tab.id).bassBoost, ...patch } })} />

      <div className="flex gap-2">
        <ToggleRow label="Mono" hint="Both ears, same sound" checked={settings.mono} onChange={(mono) => updateTab(tab.id, { mono })} />
        <ToggleRow label="Even out volume" hint="Tames loud ads, lifts quiet voices" checked={settings.compressor} onChange={(compressor) => updateTab(tab.id, { compressor })} />
      </div>

      <div>
        <SectionLabel>Devices</SectionLabel>
        <div className="mt-1">
          <DevicePickers tab={tab} />
        </div>
      </div>
    </div>
  );
}
