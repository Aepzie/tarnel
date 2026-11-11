import { useSyncExternalStore } from 'react';
import type { PanelsState } from '@shared/panels';
import { vela } from '@/lib/vela';

/**
 * Web panel state pushed by main. Subscribed only while the rail is mounted (Settings → Appearance
 * → Show panel rail), so the feature costs nothing when it is off.
 */

const EMPTY: PanelsState = { panels: [], openId: null };
let state: PanelsState = EMPTY;
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

function set(next: PanelsState): void {
  state = next;
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!unsubscribe) {
    unsubscribe = vela().panels.onState(set);
    void vela()
      .panels.list()
      .then(set)
      .catch(() => undefined);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size > 0 || !unsubscribe) return;
    unsubscribe();
    unsubscribe = null;
  };
}

export function usePanels(): PanelsState {
  return useSyncExternalStore(subscribe, () => state);
}

export function applyPanelsState(next: PanelsState): void {
  set(next);
}
