import { useSyncExternalStore } from 'react';

/**
 * Tiny UI store for chrome-local state shared across islands (palette, find bar, focus-mode reveal).
 * Not persisted; main-process state lives in hooks/browser.ts.
 */
export type PaletteMode = 'current' | 'new-tab';

export interface ChromeUIState {
  palette: { open: boolean; mode: PaletteMode; initial: string };
  find: { open: boolean };
  /** Focus mode: island temporarily revealed by hovering the top edge. */
  islandRevealed: boolean;
}

let state: ChromeUIState = {
  palette: { open: false, mode: 'current', initial: '' },
  find: { open: false },
  islandRevealed: false,
};
const listeners = new Set<() => void>();

function set(next: Partial<ChromeUIState>): void {
  state = { ...state, ...next };
  listeners.forEach((cb) => cb());
}

export function useChromeUI(): ChromeUIState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export const ui = {
  get: (): ChromeUIState => state,
  openPalette: (mode: PaletteMode = 'current', initial = ''): void => set({ palette: { open: true, mode, initial } }),
  closePalette: (): void => set({ palette: { ...state.palette, open: false } }),
  openFind: (): void => set({ find: { open: true } }),
  closeFind: (): void => set({ find: { open: false } }),
  setIslandRevealed: (islandRevealed: boolean): void => {
    if (state.islandRevealed !== islandRevealed) set({ islandRevealed });
  },
};
