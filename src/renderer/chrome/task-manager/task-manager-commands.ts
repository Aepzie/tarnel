import { Activity } from 'lucide-react';
import type { PaletteCommand } from '../palette/commands';
import { taskManager } from './task-manager-store';

/** Shortcut label (handled in main/shortcuts.ts, sent as the 'task-manager' UI command). */
export const TASK_MANAGER_SHORTCUT = 'Shift Esc';

export function taskManagerCommands(): PaletteCommand[] {
  return [
    {
      id: 'cmd:task-manager',
      title: 'Task manager',
      icon: Activity,
      keywords: 'task manager processes memory cpu performance end process kill renderer gpu extensions',
      hint: TASK_MANAGER_SHORTCUT,
      run: () => window.setTimeout(taskManager.open, 0),
    },
  ];
}
