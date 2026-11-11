import { useEffect, useState, useSyncExternalStore } from 'react';
import type { TabArchiveSnapshot } from '@shared/tab-archive';
import type { SpaceId } from '@shared/types';
import { useBrowserSlice } from '@/hooks/browser';
import { vela } from '@/lib/vela';

/** Open state of the tab archive panel (palette, strip button). */
let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (open === next) return;
  open = next;
  listeners.forEach((cb) => cb());
}

export const tabArchive = {
  open: (): void => set(true),
  close: (): void => set(false),
  setOpen: set,
};

export function useTabArchiveOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => open,
  );
}

/**
 * Archive + recently closed of the active Space. Refetches on archive changes and when the tab
 * count changes (closing a tab adds to "recently closed"). Event driven, no polling.
 */
export function useArchiveSnapshot(): TabArchiveSnapshot | null {
  const spaceId = useBrowserSlice((state) => state.activeSpaceId);
  const tabCount = useBrowserSlice((state) => state.tabs.length);
  const [snapshot, setSnapshot] = useState<TabArchiveSnapshot | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => vela().tabArchive.onChange((changed: SpaceId) => changed === spaceId && setNonce((n) => n + 1)), [spaceId]);

  useEffect(() => {
    let alive = true;
    vela()
      .tabArchive.list(spaceId)
      .then((next) => alive && setSnapshot(next))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [spaceId, nonce, tabCount]);

  return snapshot && snapshot.spaceId === spaceId ? snapshot : null;
}
