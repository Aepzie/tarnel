import { SlidersVerticalIcon } from 'lucide-react';
import type { PaletteCommand } from '../palette/commands';
import { mixerPanel } from './mixer-store';

const isMac = typeof window !== 'undefined' && window.vela?.platform === 'darwin';

/** Shortcut label (handled in main/shortcuts.ts, sent as the 'audio-mixer' UI command). */
export const MIXER_SHORTCUT = isMac ? '⌘ ⇧ M' : 'Ctrl Shift M';

export function mixerCommands(): PaletteCommand[] {
  return [
    {
      id: 'cmd:audio-mixer',
      title: 'Audio mixer',
      icon: SlidersVerticalIcon,
      keywords: 'sound volume equalizer eq bass boost balance mono compressor speaker microphone tabs mixer',
      hint: MIXER_SHORTCUT,
      run: () => window.setTimeout(mixerPanel.open, 0),
    },
  ];
}
