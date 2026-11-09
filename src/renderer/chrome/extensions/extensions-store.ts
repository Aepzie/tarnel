import { useSyncExternalStore } from 'react';
import type { ExtensionsState } from '@shared/types';

/**
 * Extension toolbar state pushed by main (installed list + actions for the active tab). One module
 * level subscription so it survives the island remounting in focus mode.
 */
const EMPTY: ExtensionsState = { extensions: [], actions: [] };

let snapshot: ExtensionsState = EMPTY;
let started = false;
const listeners = new Set<() => void>();

function emit(next: ExtensionsState): void {
  snapshot = next;
  listeners.forEach((cb) => cb());
}

function start(): void {
  if (started || !window.vela?.extensions) return;
  started = true;
  window.vela.extensions.onChange(emit);
  window.vela.extensions.get().then(emit, () => undefined);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useExtensions(): ExtensionsState {
  start();
  return useSyncExternalStore(subscribe, () => snapshot);
}
