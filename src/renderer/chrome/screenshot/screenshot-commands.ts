import { Camera } from 'lucide-react';
import { OVERLAY_EXIT_MS } from '@/hooks/overlay';
import type { PaletteCommand } from '../palette/commands';
import { screenshot } from './screenshot-store';

/** Shortcut label (handled in main/shortcuts.ts, sent as the 'screenshot' UI command). */
const isMac = typeof window !== 'undefined' && window.vela?.platform === 'darwin';
export const SCREENSHOT_SHORTCUT = isMac ? '⌘ ⇧ X' : 'Ctrl Shift X';

export function screenshotCommands(hasPage: boolean): PaletteCommand[] {
  if (!hasPage) return [];
  return [
    {
      id: 'cmd:screenshot',
      title: 'Screenshot',
      icon: Camera,
      keywords: 'screenshot capture snip image picture area full page visible annotate',
      hint: SCREENSHOT_SHORTCUT,
      // After the palette's exit (it holds the overlay ~200 ms), so the capture does not race the restack.
      run: () => window.setTimeout(() => void screenshot.start(), OVERLAY_EXIT_MS + 50),
    },
  ];
}
