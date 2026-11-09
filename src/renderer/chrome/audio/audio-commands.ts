import { MicIcon, Volume2Icon } from 'lucide-react';
import type { BrowserState, MediaDeviceSlot } from '@shared/types';
import type { PaletteCommand } from '../palette/commands';
import { DEFAULT_KEY, slotValue } from './device-sections';
import { deviceListSnapshot } from './device-store';
import { selectDevice } from './select-device';

const SLOTS: { slot: MediaDeviceSlot; verb: string; icon: typeof Volume2Icon; keywords: string }[] = [
  { slot: 'output', verb: 'Play tab audio on', icon: Volume2Icon, keywords: 'audio output speakers headphones sound device sink' },
  { slot: 'input', verb: 'Use microphone', icon: MicIcon, keywords: 'audio input microphone mic device record' },
];

/** Palette commands routing the active tab's output / microphone. Uses the last known device list. */
export function audioCommands(state: BrowserState): PaletteCommand[] {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
  if (!tab) return [];
  const list = deviceListSnapshot(true);
  return SLOTS.flatMap(({ slot, verb, icon, keywords }) => {
    const value = slotValue(tab, slot);
    const options = list.options[slot];
    const commands: PaletteCommand[] = options.map((option) => ({
      id: `cmd:audio-${slot}:${option.key}`,
      title: `${verb} ${option.label}`,
      icon,
      keywords,
      active: value === option.key,
      hint: value === option.key ? 'Current' : undefined,
      run: () => selectDevice(tab.id, slot, option.key, options),
    }));
    if (value !== DEFAULT_KEY) {
      commands.push({
        id: `cmd:audio-${slot}:default`,
        title: `${verb} system default`,
        icon,
        keywords,
        run: () => selectDevice(tab.id, slot, DEFAULT_KEY, options),
      });
    }
    return commands;
  });
}
