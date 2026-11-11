import { WebContentsView, type Input, type WebContents } from 'electron';
import { isShiftClickOpen, peekGeometry, PEEK_CLOSED, PEEK_IPC, type PeekState } from '../shared/peek';
import type { SpaceId } from '../shared/types';
import { upgradeToHttps } from './privacy';
import { getSettings } from './settings';
import { whenSessionReady } from './spaces';
import { addToSplit, createSplit, splitOf } from './split';
import { SPLIT_MAX_PANES } from '../shared/split-layout';
import {
  createTab,
  getActiveTab,
  getTabSpaceId,
  getTabVpn,
  onStateChanged,
  pageWebPreferences,
  setWindowOpenInterceptor,
} from './tabs';
import { isInternalUrl, isOpenableFromWeb, resolveInput } from './url';
import { getMainWindow, sendToChrome, setFloatingView } from './window';

/**
 * Peek: a link previewed in a floating WebContentsView above the active tab (same Space and VPN
 * route as the source tab). One at a time; closing destroys its webContents. "Open as tab" hands the
 * live view to tabs.ts, so the page keeps its state and history without a reload.
 */

interface Peek {
  view: WebContentsView;
  sourceTabId: number;
  spaceId: SpaceId;
  vpn: string | null;
  revealed: boolean;
  revealTimer: NodeJS.Timeout | null;
  /** Removes the Peek-only listeners before the view becomes a tab. */
  unwire: () => void;
}

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/** Renderer reveals the view once its open animation ran; this is the fallback if it never answers. */
const REVEAL_FALLBACK_MS = 400;
const WEB_BACKDROP = '#ffffff';

let current: Peek | null = null;

function state(): PeekState {
  const peek = current;
  const wc = peek?.view.webContents;
  if (!peek || !wc || wc.isDestroyed()) return PEEK_CLOSED;
  return {
    open: true,
    url: wc.getURL() || '',
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
  };
}

function emit(): void {
  sendToChrome(PEEK_IPC.changed, state());
}

function place(area: Parameters<typeof peekGeometry>[0]): ReturnType<typeof peekGeometry>['view'] {
  return peekGeometry(area).view;
}

function reveal(): void {
  const peek = current;
  if (!peek || peek.revealed) return;
  peek.revealed = true;
  if (peek.revealTimer) clearTimeout(peek.revealTimer);
  peek.revealTimer = null;
  setFloatingView(peek.view, place);
  const wc = peek.view.webContents;
  if (!wc.isDestroyed() && getMainWindow()?.isFocused()) wc.focus();
}

/** Detach the view; with `destroy` its webContents is closed (renderer and memory are freed). */
function release(destroy: boolean): Peek | null {
  const peek = current;
  if (!peek) return null;
  current = null;
  if (peek.revealTimer) clearTimeout(peek.revealTimer);
  peek.unwire();
  setFloatingView(null);
  const wc = peek.view.webContents;
  if (destroy && !wc.isDestroyed()) wc.close();
  emit();
  return peek;
}

export function closePeek(): void {
  release(true);
}

export function isPeekOpen(): boolean {
  return current !== null;
}

function onPeekInput(event: Electron.Event, input: Input): void {
  if (input.type !== 'keyDown' || input.key !== 'Escape' || input.shift || input.control || input.alt || input.meta) return;
  event.preventDefault();
  closePeek();
}

function wire(wc: WebContents, source: { spaceId: SpaceId; vpn: string | null }): () => void {
  const update = (): void => {
    if (current?.view.webContents === wc) emit();
  };
  const httpsOnly = (details: Electron.Event<Electron.WebContentsWillNavigateEventParams>): void => {
    if (!details.isMainFrame || details.isSameDocument || !getSettings().httpsOnly) return;
    const upgraded = upgradeToHttps(details.url);
    if (upgraded === details.url) return;
    details.preventDefault();
    void wc.loadURL(upgraded).catch(() => undefined);
  };
  const noInternal = (details: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>): void => {
    if (isInternalUrl(details.url)) details.preventDefault();
  };
  const onGone = (): void => {
    if (current?.view.webContents === wc) closePeek();
  };
  const events = ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const;
  for (const name of events) wc.on(name as 'did-start-loading', update);
  wc.on('will-navigate', httpsOnly);
  wc.on('will-frame-navigate', noInternal);
  wc.on('before-input-event', onPeekInput);
  wc.on('render-process-gone', onGone);
  wc.on('will-attach-webview', (event) => event.preventDefault());
  // Links that want a new window leave the preview as background tabs of the source Space.
  wc.setWindowOpenHandler(({ url }) => {
    if (isOpenableFromWeb(url)) createTab({ url, spaceId: source.spaceId, vpn: source.vpn, active: false });
    return { action: 'deny' };
  });
  return () => {
    for (const name of events) wc.removeListener(name as 'did-start-loading', update);
    wc.removeListener('will-navigate', httpsOnly);
    wc.removeListener('will-frame-navigate', noInternal);
    wc.removeListener('before-input-event', onPeekInput);
    wc.removeListener('render-process-gone', onGone);
  };
}

/** Open `url` in Peek over `sourceTabId` (default: the active tab). Reuses an open Peek. */
export function openPeek(url: string, sourceTabId: number | null = getActiveTab()): boolean {
  if (!isOpenableFromWeb(url) || sourceTabId === null || !getMainWindow()) return false;
  const spaceId = getTabSpaceId(sourceTabId);
  if (!spaceId) return false;
  const target = getSettings().httpsOnly ? upgradeToHttps(url) : url;
  const vpn = getTabVpn(sourceTabId);
  if (current && current.sourceTabId === sourceTabId && current.spaceId === spaceId && current.vpn === vpn) {
    void current.view.webContents.loadURL(target).catch(() => undefined);
    return true;
  }
  closePeek();
  const view = new WebContentsView({ webPreferences: pageWebPreferences(spaceId, vpn) });
  view.setBackgroundColor(WEB_BACKDROP);
  const wc = view.webContents;
  const peek: Peek = {
    view,
    sourceTabId,
    spaceId,
    vpn,
    revealed: false,
    revealTimer: setTimeout(reveal, REVEAL_FALLBACK_MS),
    unwire: wire(wc, { spaceId, vpn }),
  };
  current = peek;
  whenSessionReady(spaceId, vpn).then(
    () => {
      if (current === peek && !wc.isDestroyed()) void wc.loadURL(target).catch(() => undefined);
    },
    () => {
      if (current === peek) closePeek();
    },
  );
  emit();
  return true;
}

/** Turn the preview into a real tab right after its source tab, keeping the live page (no reload). */
function toTab(active: boolean): number | null {
  const peek = release(false);
  if (!peek) return null;
  const wc = peek.view.webContents;
  if (wc.isDestroyed()) return null;
  return createTab({
    view: peek.view,
    url: wc.getURL() || undefined,
    title: wc.getTitle(),
    spaceId: peek.spaceId,
    vpn: peek.vpn,
    active,
    afterId: peek.sourceTabId,
  });
}

export function peekToTab(): number | null {
  return toTab(true);
}

/** Show the preview next to its source tab (joins the source's split while it has room). */
export function peekToSplit(): void {
  const sourceTabId = current?.sourceTabId;
  if (sourceTabId === undefined) return;
  const tabId = toTab(false);
  if (tabId === null) return;
  const split = splitOf(sourceTabId);
  if (split && split.tabIds.length < SPLIT_MAX_PANES) {
    addToSplit(split.id, tabId, split.tabIds.indexOf(sourceTabId) + 1);
    return;
  }
  createSplit([sourceTabId, tabId], tabId);
}

function shiftClickInterceptor(tabId: number, url: string, disposition: string, features: string): boolean {
  if (!getSettings().peekOnShiftClick || !isShiftClickOpen(disposition, features)) return false;
  if (tabId !== getActiveTab()) return false;
  return openPeek(url, tabId);
}

function str(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new TypeError('Invalid input');
  return value;
}

/** Wires shift-click interception, source-tab tracking and the chrome IPC. */
export function registerPeekIpc(handle: ChromeHandler): void {
  setWindowOpenInterceptor(shiftClickInterceptor);
  // Switching tab / Space (or closing the source tab) dismisses the preview.
  onStateChanged(() => {
    if (current && getActiveTab() !== current.sourceTabId) closePeek();
  });
  handle(PEEK_IPC.open, (input) => {
    const url = resolveInput(str(input, 4096), getSettings().searchEngine);
    return url ? openPeek(url) : false;
  });
  handle(PEEK_IPC.close, () => closePeek());
  handle(PEEK_IPC.reveal, () => reveal());
  handle(PEEK_IPC.back, () => {
    const history = current?.view.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  });
  handle(PEEK_IPC.reload, () => current?.view.webContents.reload());
  handle(PEEK_IPC.toTab, () => peekToTab());
  handle(PEEK_IPC.toSplit, () => peekToSplit());
}
