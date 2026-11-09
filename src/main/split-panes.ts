import type { Event, MouseInputEvent, WebContents, WebContentsView } from 'electron';
import { IPC } from '../shared/ipc';
import { sendToChrome } from './window';

/**
 * Pointer tracking for the panes of the split on screen: a press in a pane focuses it, and hovering
 * the top-center hot zone of a pane tells the chrome to show that pane's toolbar. Listeners are
 * attached only while a split is visible, so single-tab browsing pays nothing.
 */

export interface Pane {
  tabId: number;
  view: WebContentsView;
}

/** Hot zone at the top center of a pane (DIP). The chrome keeps the toolbar while the pointer stays in a larger zone. */
export const PANE_HOT_WIDTH = 200;
export const PANE_HOT_HEIGHT = 40;

type MouseListener = (event: Event, mouse: MouseInputEvent) => void;

const tracked = new Map<WebContents, { view: WebContentsView; listener: MouseListener }>();
let hovered: number | null = null;
let focusPane: (tabId: number) => void = () => undefined;

export function onPaneFocus(cb: (tabId: number) => void): void {
  focusPane = cb;
}

function setHovered(tabId: number | null): void {
  if (hovered === tabId) return;
  hovered = tabId;
  sendToChrome(IPC.chromeEvents.splitHover, tabId);
}

function buttonHeld(mouse: MouseInputEvent): boolean {
  return mouse.modifiers?.some((key) => /buttondown$/i.test(key)) ?? false;
}

function listen(tabId: number, view: WebContentsView): MouseListener {
  return (_event, mouse) => {
    if (mouse.type === 'mouseDown' || mouse.type === 'contextMenu') {
      focusPane(tabId);
      return;
    }
    if (mouse.type === 'mouseLeave') {
      if (hovered === tabId) setHovered(null);
      return;
    }
    if (mouse.type !== 'mouseMove') return;
    const { width } = view.getBounds();
    const inside = !buttonHeld(mouse) && mouse.y >= 0 && mouse.y < PANE_HOT_HEIGHT && Math.abs(mouse.x - width / 2) <= PANE_HOT_WIDTH / 2;
    if (inside) setHovered(tabId);
    else if (hovered === tabId) setHovered(null);
  };
}

/** Track exactly `panes` (pass [] when no split is on screen). */
export function trackPanes(panes: readonly Pane[]): void {
  const next = new Map(panes.map((pane) => [pane.view.webContents, pane]));
  for (const [wc, entry] of tracked) {
    if (next.get(wc)?.view === entry.view) continue;
    if (!wc.isDestroyed()) wc.off('before-mouse-event', entry.listener);
    tracked.delete(wc);
  }
  for (const [wc, pane] of next) {
    if (tracked.has(wc) || wc.isDestroyed()) continue;
    const listener = listen(pane.tabId, pane.view);
    wc.on('before-mouse-event', listener);
    tracked.set(wc, { view: pane.view, listener });
  }
  if (hovered !== null && !panes.some((pane) => pane.tabId === hovered)) setHovered(null);
}
