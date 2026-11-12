import { useSyncExternalStore } from 'react';
import type { ScreenshotCapture } from '@shared/screenshot';

/** The image the editor works on (already cropped to the selected area). */
export interface EditorImage {
  dataUrl: string;
  width: number;
  height: number;
  title: string;
  truncated: boolean;
}

export type ScreenshotPhase =
  | { kind: 'idle' }
  | { kind: 'capturing' }
  | { kind: 'select'; capture: ScreenshotCapture }
  | { kind: 'edit'; image: EditorImage };

let phase: ScreenshotPhase = { kind: 'idle' };
let error: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((cb) => cb());
}

function set(next: ScreenshotPhase, nextError: string | null = null): void {
  phase = next;
  error = nextError;
  emit();
}

const describe = (reason: unknown): string => {
  const message = reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '') : '';
  return message || 'Capture failed';
};

/** Start: freeze the visible page so an area can be dragged over it. */
async function start(): Promise<void> {
  if (phase.kind !== 'idle') return;
  set({ kind: 'capturing' });
  try {
    const capture = await window.vela.screenshot.captureVisible();
    if (screenshot.get().kind === 'capturing') set({ kind: 'select', capture });
  } catch (reason) {
    set({ kind: 'idle' }, describe(reason));
  }
}

function editCapture(capture: ScreenshotCapture): void {
  set({ kind: 'edit', image: { dataUrl: capture.dataUrl, width: capture.width, height: capture.height, title: capture.title, truncated: capture.truncated } });
}

async function fullPage(): Promise<void> {
  if (phase.kind !== 'select') return;
  const previous = phase;
  set({ kind: 'capturing' });
  try {
    editCapture(await window.vela.screenshot.captureFullPage());
  } catch (reason) {
    set(previous, describe(reason));
  }
}

export const screenshot = {
  start,
  fullPage,
  visible: (): void => {
    if (phase.kind === 'select') editCapture(phase.capture);
  },
  edit: (image: EditorImage): void => set({ kind: 'edit', image }),
  close: (): void => set({ kind: 'idle' }),
  get: (): ScreenshotPhase => phase,
};

export function useScreenshotPhase(): ScreenshotPhase {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => phase,
  );
}

export function useScreenshotError(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => error,
  );
}
