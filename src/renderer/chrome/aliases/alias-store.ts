import { useSyncExternalStore } from 'react';
import type { AliasOffer } from '@shared/aliases';
import { settle, vela } from '@/lib/vela';

/** Alias offers pushed by main (one per tab). They never contain the API key. */
let offers: readonly AliasOffer[] = [];
const listeners = new Set<() => void>();
let started = false;

function emit(next: readonly AliasOffer[]): void {
  offers = next;
  listeners.forEach((cb) => cb());
}

function start(): void {
  if (started || !window.vela?.aliases) return;
  started = true;
  const api = vela().aliases;
  api.onOffer((offer) => emit([...offers.filter((pending) => pending.tabId !== offer.tabId), offer]));
  api.onOfferCancel((id) => emit(offers.filter((pending) => pending.id !== id)));
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAliasOffers(): readonly AliasOffer[] {
  start();
  return useSyncExternalStore(subscribe, () => offers);
}

export function createAlias(offerId: string): Promise<{ email: string }> {
  return vela().aliases.create(offerId);
}

export function dismissAlias(offerId: string): void {
  emit(offers.filter((pending) => pending.id !== offerId));
  settle(vela().aliases.dismiss(offerId));
}
