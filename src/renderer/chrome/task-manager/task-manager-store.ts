import { useSyncExternalStore } from 'react';

/** Open state of the task manager panel (Shift+Esc, palette, perf popover). */
let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (open === next) return;
  open = next;
  listeners.forEach((cb) => cb());
}

export const taskManager = {
  open: (): void => set(true),
  close: (): void => set(false),
  toggle: (): void => set(!open),
  setOpen: set,
};

export function useTaskManagerOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => open,
  );
}
