import { useSyncExternalStore } from 'react';
import type { SpaceColor, TabGroupId, TabState } from '@shared/types';
import { SPACE_HEX, settle, vela } from '@/lib/vela';

/** Group whose name is being edited inline (chip or vertical header). Chrome-local, not persisted. */
let editing: TabGroupId | null = null;
const listeners = new Set<() => void>();

export function setEditingGroup(id: TabGroupId | null): void {
  if (editing === id) return;
  editing = id;
  listeners.forEach((cb) => cb());
}

export function useEditingGroup(): TabGroupId | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => editing,
  );
}

/** Group the tabs into a new group and open its name editor. */
export async function groupIntoNew(tabIds: number[]): Promise<void> {
  try {
    const id = await vela().groups.create(tabIds);
    setEditingGroup(id);
  } catch {
    /* main rejected (tab closed meanwhile) */
  }
}

/** Move the active tab into a new group of its own (palette command). */
export function groupActiveTab(tabs: TabState[], activeTabId: number | null): void {
  const tab = tabs.find((candidate) => candidate.id === activeTabId);
  if (tab) settle(groupIntoNew([tab.id]));
}

/** CSS custom properties that tint a group surface with its color (`--group`). */
export function groupStyle(color: SpaceColor): Record<string, string> {
  return { '--group': SPACE_HEX[color] };
}

/** Label tint: the raw color on dark islands, a darker mix on light ones. */
export const GROUP_TEXT = 'text-[var(--group)] light:text-[color-mix(in_oklab,var(--group)_62%,black)]';
export const GROUP_FILL = 'bg-[color-mix(in_oklab,var(--group)_16%,transparent)] light:bg-[color-mix(in_oklab,var(--group)_18%,transparent)]';
