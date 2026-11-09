import { useSyncExternalStore } from 'react';
import type { PermissionRequest } from '@shared/types';
import { settle, vela } from '@/lib/vela';

/** Pending site permission requests, oldest first. One prompt is shown at a time. */
let queue: readonly PermissionRequest[] = [];
const listeners = new Set<() => void>();
let started = false;

function emit(next: readonly PermissionRequest[]): void {
  queue = next;
  listeners.forEach((cb) => cb());
}

function start(): void {
  if (started || !window.vela) return;
  started = true;
  vela().onPermission((request) => {
    if (queue.some((pending) => pending.id === request.id)) return;
    emit([...queue, request]);
  });
  vela().onPermissionCancel((id) => {
    if (!queue.some((pending) => pending.id === id)) return;
    emit(queue.filter((pending) => pending.id !== id));
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePermissionQueue(): readonly PermissionRequest[] {
  start();
  return useSyncExternalStore(subscribe, () => queue);
}

export function respondToPermission(id: string, allow: boolean, remember: boolean): void {
  emit(queue.filter((pending) => pending.id !== id));
  settle(vela().permissions.respond(id, allow, remember));
}

/** Requests from the active tab come first; otherwise the oldest pending one. */
export function pickPermission(pending: readonly PermissionRequest[], activeTabId: number | null): PermissionRequest | undefined {
  return pending.find((request) => request.tabId !== null && request.tabId === activeTabId) ?? pending[0];
}
