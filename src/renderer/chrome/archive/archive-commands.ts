import { Archive, ArchiveRestore } from 'lucide-react';
import type { PaletteCommand } from '../palette/commands';
import { settle, vela } from '@/lib/vela';
import { tabArchive } from './archive-store';

/** Handled in main/shortcuts.ts. */
export const ARCHIVE_TAB_SHORTCUT = 'Ctrl Shift E';

export function archiveCommands(activeTabId: number | null): PaletteCommand[] {
  const commands: PaletteCommand[] = [
    {
      id: 'cmd:tab-archive',
      title: 'Tab archive',
      icon: ArchiveRestore,
      keywords: 'archive archived restore recently closed reopen old tabs',
      run: () => window.setTimeout(tabArchive.open, 0),
    },
  ];
  if (activeTabId !== null) {
    commands.push({
      id: 'cmd:archive-tab',
      title: 'Move tab to archive',
      icon: Archive,
      keywords: 'archive tab hide later stash',
      hint: ARCHIVE_TAB_SHORTCUT,
      run: () => settle(vela().tabArchive.archiveTabs([activeTabId])),
    });
  }
  return commands;
}
