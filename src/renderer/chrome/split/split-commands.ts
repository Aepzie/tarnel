import { ArrowLeftRight, Columns2 } from 'lucide-react';
import type { BrowserState } from '@shared/types';
import type { PaletteCommand } from '../palette/commands';
import { ui } from '../ui-store';
import { activeSplitOf } from './split-state';

const HINT = window.vela?.platform === 'darwin' ? '⌘ ⇧ D' : 'Ctrl Shift D';

/** Palette commands for split view. */
export function splitCommands(state: BrowserState): PaletteCommand[] {
  const vela = window.vela;
  if (state.activeTabId === null) return [];
  const split = activeSplitOf(state);
  if (!split) {
    return [
      {
        id: 'cmd:split',
        title: 'Split view',
        icon: Columns2,
        keywords: 'side by side two tabs compare screen panes',
        hint: HINT,
        run: () =>
          void vela.split.toggle().then((created) => {
            if (created !== null) ui.openPalette('current');
          }),
      },
    ];
  }
  return [
    {
      id: 'cmd:split-close',
      title: 'Close split view',
      icon: Columns2,
      keywords: 'split side by side exit separate panes',
      hint: HINT,
      run: () => void vela.split.close(split.id),
    },
    {
      id: 'cmd:split-swap',
      title: split.tabIds.length === 2 ? 'Swap split panes' : 'Rotate split panes',
      icon: ArrowLeftRight,
      keywords: 'split side by side switch flip panes',
      run: () => void vela.split.swap(split.id),
    },
  ];
}
