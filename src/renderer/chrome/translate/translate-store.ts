import { useEffect, useState } from 'react';
import type { TranslateTabState } from '@shared/translate';

const states = new Map<number, TranslateTabState>();
const listeners = new Set<() => void>();
let subscribed = false;

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  window.vela.translate.onState((state) => {
    states.set(state.tabId, state);
    for (const listener of listeners) listener();
  });
}

export function translateStateOf(tabId: number): TranslateTabState | undefined {
  return states.get(tabId);
}

/** Translation state of a tab; asks main once per mount (main detects the language lazily). */
export function useTranslateState(tabId: number | null): TranslateTabState | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (tabId === null) return;
    subscribe();
    const listener = (): void => force((n) => n + 1);
    listeners.add(listener);
    void window.vela.translate.state(tabId).then((state) => {
      states.set(tabId, state);
      listener();
    }).catch(() => undefined);
    return () => {
      listeners.delete(listener);
    };
  }, [tabId]);
  return tabId === null ? null : (states.get(tabId) ?? null);
}

/** Translate, or show the original when the page is translated / being translated. */
export function toggleTranslation(tabId: number): void {
  subscribe();
  const state = states.get(tabId);
  if (state && (state.phase === 'translated' || state.phase === 'translating' || state.phase === 'downloading')) {
    void window.vela.translate.showOriginal(tabId);
    return;
  }
  void window.vela.translate.page(tabId);
}
