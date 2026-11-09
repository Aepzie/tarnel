import { useSyncExternalStore } from 'react';
import type { ContentBounds } from '@shared/types';

/** The page area rect (CSS px) last reported to main by `Viewport`, for chrome layers that must line up with it. */
let rect: ContentBounds | null = null;
const listeners = new Set<() => void>();

export function setViewportRect(next: ContentBounds): void {
  if (rect && rect.x === next.x && rect.y === next.y && rect.width === next.width && rect.height === next.height) return;
  rect = next;
  listeners.forEach((cb) => cb());
}

export function useViewportRect(): ContentBounds | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => rect,
  );
}
