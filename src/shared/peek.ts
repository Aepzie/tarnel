import type { ContentBounds } from './types';

/**
 * Peek: a link previewed in a floating page view over the active tab. Geometry is shared by main
 * (places the view) and the chrome (draws the frame, toolbar and dimmed backdrop) so both agree.
 */

export const PEEK_IPC = {
  open: 'chrome:peek-open',
  close: 'chrome:peek-close',
  reveal: 'chrome:peek-reveal',
  back: 'chrome:peek-back',
  reload: 'chrome:peek-reload',
  toTab: 'chrome:peek-to-tab',
  toSplit: 'chrome:peek-to-split',
  changed: 'chrome-event:peek',
} as const;

export interface PeekState {
  open: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
}

export const PEEK_CLOSED: PeekState = { open: false, url: '', title: '', loading: false, canGoBack: false };

/** Share of the page area the preview card covers. */
export const PEEK_SCALE = 0.8;
/** Height of the toolbar strip at the top of the card; the page view sits below it. */
export const PEEK_TOOLBAR = 40;
const PEEK_MIN_WIDTH = 320;
const PEEK_MIN_HEIGHT = 240;

export interface PeekGeometry {
  /** Whole card (toolbar + page), window coordinates. */
  card: ContentBounds;
  /** Where the page view goes. */
  view: ContentBounds;
}

/** Card centred in the page area at ~80 %, never larger than the area itself. */
export function peekGeometry(area: ContentBounds): PeekGeometry {
  const width = Math.round(Math.min(area.width, Math.max(PEEK_MIN_WIDTH, area.width * PEEK_SCALE)));
  const height = Math.round(Math.min(area.height, Math.max(PEEK_MIN_HEIGHT, area.height * PEEK_SCALE)));
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + (area.height - height) / 2);
  const card = { x, y, width, height };
  const view = { x, y: y + PEEK_TOOLBAR, width, height: Math.max(0, height - PEEK_TOOLBAR) };
  return { card, view };
}

/**
 * A shift-click on a link reaches the window-open handler as disposition 'new-window' without
 * window features; scripted popups (`window.open(url, name, 'width=…')`) always carry features.
 */
export function isShiftClickOpen(disposition: string, features: string): boolean {
  return disposition === 'new-window' && features.trim() === '';
}

/** Short host shown in the Peek toolbar ("example.com"), the raw text when it is not a URL. */
export function peekHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}
