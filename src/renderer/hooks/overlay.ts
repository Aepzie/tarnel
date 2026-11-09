import { useEffect, useState } from 'react';

/**
 * Overlay manager. The page WebContentsView sits ABOVE the chrome UI. While anything that may
 * overlap the page area is open (palette, menus, popovers, toasts, revealed island) the chrome view
 * must be raised via `vela.ui.setOverlay(true)`. Holders are ref-counted and the IPC is coalesced
 * per microtask so switching from one menu to another never flashes the page on top.
 */
let holders = 0;
let sent = false;
let queued = false;

function send(want: boolean, retry: boolean): void {
  window.vela.ui.setOverlay(want).catch(() => {
    if (sent !== want) return;
    if (retry) send(want, false);
    else sent = !want;
  });
}

function flush(): void {
  queued = false;
  const want = holders > 0;
  if (want === sent) return;
  sent = want;
  send(want, true);
}

let booted = false;

/** Reconcile main's overlay flag with a freshly booted renderer (reload/crash may leave it raised). */
export function resetOverlayOnBoot(): void {
  if (booted || !window.vela) return;
  booted = true;
  sent = false;
  send(false, true);
  schedule();
}

function schedule(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(flush);
}

export function acquireOverlay(): () => void {
  holders += 1;
  schedule();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    schedule();
  };
}

/** Hold the overlay while `open` is true. Use for every Radix popover/menu/dialog in the chrome. */
export function useOverlay(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    return acquireOverlay();
  }, [open]);
}

/** Default time a closing surface keeps the overlay so its exit animation is not painted over. */
export const OVERLAY_EXIT_MS = 200;

/**
 * Like `useOverlay`, but keeps holding for `exitMs` after `open` turns false so Radix/motion exit
 * animations finish above the page instead of being cut off by it.
 */
export function useOverlayPresence(open: boolean, exitMs = OVERLAY_EXIT_MS): void {
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (open) {
      setLingering(true);
      return;
    }
    const timer = window.setTimeout(() => setLingering(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);
  useOverlay(open || lingering);
}
