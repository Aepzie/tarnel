import { useState, type SyntheticEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { CheckIcon, MicIcon, Volume2Icon, VolumeXIcon } from 'lucide-react';
import type { MediaDeviceSlot, TabState } from '@shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { useBrowserSlice } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { hostOf, settle, vela } from '@/lib/vela';
import { DEFAULT_KEY, SLOT_TITLES, missingSlots, slotValue, useDeviceSections, type DeviceSection } from './device-sections';
import { useDeviceList } from './device-store';
import { selectDevice } from './select-device';

const POPOVER_SLOTS: readonly MediaDeviceSlot[] = ['output', 'input'];

/** Keeps clicks inside the portaled popover from reaching the tab (activate, palette, drag, context menu). */
const stop = (event: SyntheticEvent): void => event.stopPropagation();

function DeviceRow({ label, title, hint, selected, warn, disabled, layoutId, reduced, onSelect }: {
  label: string;
  title?: string;
  hint?: string | null;
  selected: boolean;
  warn?: boolean;
  disabled?: boolean;
  layoutId: string;
  reduced: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      title={title}
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pr-2 pl-1.5 text-left text-[12.5px] tracking-tight outline-none',
        'text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:bg-white/[0.06]',
        'light:text-zinc-700 light:hover:bg-black/[0.05] light:hover:text-zinc-900 light:focus-visible:bg-black/[0.05]',
        selected && 'text-zinc-100 light:text-zinc-900',
        disabled && 'pointer-events-none',
      )}
    >
      <span className="grid size-4 shrink-0 place-items-center">
        {selected && (
          <motion.span layoutId={layoutId} transition={reduced ? { duration: 0 } : spring.snappy} className="grid place-items-center text-space">
            <CheckIcon className="size-3.5" strokeWidth={2.25} />
          </motion.span>
        )}
      </span>
      <span className={cn('max-w-[70%] shrink-0 truncate', disabled && 'text-zinc-500')}>{label}</span>
      {hint && (
        <span className={cn('ml-auto min-w-0 shrink truncate pl-2 text-[11.5px]', warn ? 'shrink-0 text-amber-400/90 light:text-amber-600' : 'text-zinc-500')}>{hint}</span>
      )}
    </button>
  );
}

function Section({ tab, section, reduced }: { tab: TabState; section: DeviceSection; reduced: boolean }) {
  const value = slotValue(tab, section.slot);
  const layoutId = `audio-check-${tab.id}-${section.slot}`;
  const pick = (key: string): void => selectDevice(tab.id, section.slot, key, section.options);
  return (
    <div role="radiogroup" aria-label={SLOT_TITLES[section.slot]} className="px-1.5 pb-1.5">
      <div className="px-1.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{SLOT_TITLES[section.slot]}</div>
      <DeviceRow
        label="System default"
        hint={section.defaultName}
        selected={value === DEFAULT_KEY}
        layoutId={layoutId}
        reduced={reduced}
        onSelect={() => pick(DEFAULT_KEY)}
      />
      {section.missing && (
        <DeviceRow label={section.missing.name} title={section.missing.label} hint="Disconnected" warn selected disabled layoutId={layoutId} reduced={reduced} onSelect={() => undefined} />
      )}
      {section.options.map((option) => (
        <DeviceRow
          key={option.key}
          label={option.name}
          title={option.label}
          hint={option.detail}
          selected={value === option.key}
          layoutId={layoutId}
          reduced={reduced}
          onSelect={() => pick(option.key)}
        />
      ))}
    </div>
  );
}

function AudioPanel({ tabId }: { tabId: number }) {
  const tab = useBrowserSlice((s) => s.tabs.find((candidate) => candidate.id === tabId));
  const reduced = !!useReducedMotion();
  const sections = useDeviceSections(tab ?? EMPTY_TAB, !!tab, POPOVER_SLOTS);
  if (!tab) return null;
  return (
    <>
      <div className="flex h-11 items-center gap-2.5 px-3.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold tracking-tight text-foreground">Sound</span>
          <span className="block truncate text-[11px] text-zinc-500">{hostOf(tab.url) || 'This tab'} · this tab only</span>
        </span>
        <label className="flex cursor-default items-center gap-2 text-[12px] text-zinc-400 light:text-zinc-600">
          Mute
          <Switch size="sm" checked={tab.muted} onCheckedChange={() => settle(vela().tabs.toggleMute(tab.id))} />
        </label>
      </div>
      <div className="mx-3 h-px bg-border" />
      <div className="max-h-[min(440px,60vh)] overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section) => (
          <Section key={section.slot} tab={tab} section={section} reduced={reduced} />
        ))}
      </div>
    </>
  );
}

const EMPTY_TAB = { devices: null } as TabState;

const sameJson = <T,>(a: T, b: T): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Amber dot while a device picked for the tab is unplugged (the tab then uses the system default). */
function UnpluggedDot({ tabId }: { tabId: number }) {
  const devices = useBrowserSlice((s) => s.tabs.find((candidate) => candidate.id === tabId)?.devices ?? null, sameJson);
  const list = useDeviceList(!!devices);
  if (!devices || missingSlots({ devices } as TabState, list).length === 0) return null;
  return (
    <span
      role="img"
      aria-label="A picked device is disconnected; using the system default"
      className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-400 shadow-[0_0_0_1.5px_var(--island)]"
    />
  );
}

/**
 * Speaker / microphone indicator of a tab. Shown while the tab is audible, muted or was granted the
 * microphone; opens a popover with mute and this tab's output and microphone.
 */
export function TabAudioButton({ tab, className }: { tab: TabState; className?: string }) {
  const [open, setOpen] = useState(false);
  useOverlayPresence(open);
  const sound = tab.audible || tab.muted;
  if (!sound && !tab.micActive && !open) return null;
  const SpeakerIcon = tab.muted ? VolumeXIcon : Volume2Icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Sound settings"
          title="Sound settings"
          className={cn(
            'no-drag relative inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-md px-[3px] text-zinc-400 transition-colors duration-150 hover:bg-white/10 hover:text-zinc-100 active:scale-[0.92] light:text-zinc-500 light:hover:bg-black/[0.07] light:hover:text-zinc-900',
            tab.muted && 'text-zinc-500',
            open && 'bg-white/10 text-zinc-100 light:bg-black/[0.07] light:text-zinc-900',
            className,
          )}
          onPointerDown={stop}
          onClick={stop}
          onDoubleClick={stop}
        >
          {(sound || !tab.micActive) && <SpeakerIcon className="size-3.5" strokeWidth={1.75} />}
          {tab.micActive && <MicIcon className="size-3.5 text-space" strokeWidth={1.75} />}
          {tab.devices && <UnpluggedDot tabId={tab.id} />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDown={stop}
        onClick={stop}
        onContextMenu={stop}
        onKeyDown={stop}
        className="w-80 overflow-hidden rounded-2xl border-0 bg-popover p-0 shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_24px_64px_-12px_rgb(0_0_0/0.55)] backdrop-blur-2xl backdrop-saturate-150"
      >
        <AudioPanel tabId={tab.id} />
      </PopoverContent>
    </Popover>
  );
}
