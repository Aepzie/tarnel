import { useSyncExternalStore } from 'react';
import type { PasswordFillOffer, PasswordSaveAnswer, PasswordSavePrompt } from '@shared/passwords';
import { settle, vela } from '@/lib/vela';

/** Pending save prompts and fill offers pushed by main. They never contain a password. */
interface PasswordQueue {
  saves: readonly PasswordSavePrompt[];
  offers: readonly PasswordFillOffer[];
}

let queue: PasswordQueue = { saves: [], offers: [] };
const listeners = new Set<() => void>();
let started = false;

function emit(next: PasswordQueue): void {
  queue = next;
  listeners.forEach((cb) => cb());
}

function start(): void {
  if (started || !window.vela?.passwords) return;
  started = true;
  const api = vela().passwords;
  api.onSavePrompt((prompt) => emit({ ...queue, saves: [...queue.saves.filter((pending) => pending.tabId !== prompt.tabId), prompt] }));
  api.onSaveCancel((id) => emit({ ...queue, saves: queue.saves.filter((pending) => pending.id !== id) }));
  api.onFillOffer((offer) => emit({ ...queue, offers: [...queue.offers.filter((pending) => pending.tabId !== offer.tabId), offer] }));
  api.onFillCancel((id) => emit({ ...queue, offers: queue.offers.filter((pending) => pending.id !== id) }));
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePasswordQueue(): PasswordQueue {
  start();
  return useSyncExternalStore(subscribe, () => queue);
}

export function answerSave(id: string, answer: PasswordSaveAnswer): void {
  emit({ ...queue, saves: queue.saves.filter((pending) => pending.id !== id) });
  settle(vela().passwords.answerSave(id, answer));
}

export function fillAccount(offerId: string, loginId: string): void {
  emit({ ...queue, offers: queue.offers.filter((pending) => pending.id !== offerId) });
  settle(vela().passwords.fill(offerId, loginId));
}

export function dismissOffer(offerId: string): void {
  emit({ ...queue, offers: queue.offers.filter((pending) => pending.id !== offerId) });
  settle(vela().passwords.dismissOffer(offerId));
}
