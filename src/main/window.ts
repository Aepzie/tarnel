import { BrowserWindow, WebContentsView, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import type { ContentBounds, WindowMaterial } from '../shared/types';
import { getSettings } from './settings';
import { createStore, type JsonStore } from './store';

interface WindowFile {
  bounds: Rectangle | null;
  maximized: boolean;
}

const TAB_RADIUS = 12;

let win: BrowserWindow | null = null;
let chromeView: WebContentsView | null = null;
let activeView: WebContentsView | null = null;
let contentBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
let overlayOpen = false;
let htmlFullscreen = false;
/** Window fullscreen state (F11) before a page entered HTML fullscreen. */
let fullscreenBeforeHtml = false;
let store: JsonStore<WindowFile> | null = null;

function getStore(): JsonStore<WindowFile> {
  store ??= createStore<WindowFile>('window', { bounds: null, maximized: false });
  return store;
}

function boundsVisible(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const h = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return w >= 100 && h >= 50;
  });
}

function setRadius(view: WebContentsView, radius: number): void {
  const withRadius = view as WebContentsView & { setBorderRadius?: (r: number) => void };
  if (typeof withRadius.setBorderRadius === 'function') withRadius.setBorderRadius(radius);
}

function windowSize(): { width: number; height: number } {
  if (!win || win.isDestroyed()) return { width: 0, height: 0 };
  const [width = 0, height = 0] = win.getContentSize();
  return { width, height };
}

function layout(): void {
  if (!win || win.isDestroyed()) return;
  const size = windowSize();
  chromeView?.setBounds({ x: 0, y: 0, ...size });
  if (!activeView) return;
  if (htmlFullscreen) {
    setRadius(activeView, 0);
    activeView.setBounds({ x: 0, y: 0, ...size });
    return;
  }
  setRadius(activeView, TAB_RADIUS);
  activeView.setBounds({
    x: Math.max(0, Math.round(contentBounds.x)),
    y: Math.max(0, Math.round(contentBounds.y)),
    width: Math.max(0, Math.round(contentBounds.width)),
    height: Math.max(0, Math.round(contentBounds.height)),
  });
}

/** Persist window bounds/maximized state (also called on quit before stores are flushed). */
export function saveBounds(): void {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;
  getStore().set({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
}

export function sendToChrome(channel: string, ...args: unknown[]): void {
  const wc = chromeView?.webContents;
  if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
}

/**
 * Windows 11 (22H2+) system backdrop. With Mica/Acrylic the window background is transparent so
 * the desktop shimmers through the gaps between the floating islands.
 */
function supportsMaterial(): boolean {
  if (process.platform !== 'win32') return false;
  const build = Number(process.getSystemVersion().split('.')[2] ?? 0);
  return build >= 22621;
}

type WindowLook = Pick<Electron.BrowserWindowConstructorOptions, 'backgroundColor' | 'backgroundMaterial' | 'transparent'>;

const OPAQUE_BG = '#09090b';
const CLEAR_BG = '#00000000';

/**
 * 'none' = fully transparent window: the desktop shows (unblurred) around the islands.
 * Mica/Acrylic = opaque-to-DWM window with a system backdrop. `transparent` is construction-only,
 * so switching between the two families recreates the window (see swapWindow).
 */
function windowLook(material: WindowMaterial): WindowLook {
  if (material === 'none') return { transparent: true, backgroundColor: CLEAR_BG };
  if (!supportsMaterial()) return { backgroundColor: OPAQUE_BG };
  return { backgroundColor: CLEAR_BG, backgroundMaterial: material };
}

/** Handlers registered by this module on the current window (others' listeners get migrated). */
const ownListeners = new Set<(...args: never[]) => void>();
let windowTransparent = false;

function own<T extends (...args: never[]) => void>(fn: T): T {
  ownListeners.add(fn);
  return fn;
}

function buildWindow(material: WindowMaterial, bounds: Rectangle | null): BrowserWindow {
  const look = windowLook(material);
  windowTransparent = look.transparent === true;
  return new BrowserWindow({
    ...(bounds ?? { width: 1280, height: 820 }),
    minWidth: 640,
    minHeight: 400,
    frame: false,
    show: false,
    resizable: true,
    ...look,
    title: 'Vela',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
}

/** Per-window event wiring (layout, persistence, maximized/fullscreen state). */
function wireWindow(current: BrowserWindow): void {
  ownListeners.clear();
  current.on('resize', own(layout));
  current.on('resized', own(saveBounds));
  current.on('moved', own(saveBounds));
  const emitMaximized = own((): void => {
    layout();
    saveBounds();
    sendToChrome(IPC.chromeEvents.maximized, current.isMaximized());
  });
  current.on('maximize', emitMaximized);
  current.on('unmaximize', emitMaximized);
  current.on('enter-full-screen', own(layout));
  current.on(
    'leave-full-screen',
    own(() => {
      htmlFullscreen = false;
      layout();
    }),
  );
  current.on('close', own(saveBounds));
  current.on(
    'closed',
    own(() => {
      if (win !== current) return;
      win = null;
      chromeView = null;
      activeView = null;
      htmlFullscreen = false;
      overlayOpen = false;
    }),
  );
}

/** Re-add views in layer order: chrome base, active tab on top, chrome again when overlaid. */
function attachViews(target: BrowserWindow): void {
  if (chromeView) target.contentView.addChildView(chromeView);
  if (activeView) target.contentView.addChildView(activeView);
  if (overlayOpen && chromeView) target.contentView.addChildView(chromeView);
}

/**
 * Replace the window with one built for `material`, moving the live views (no reload) and every
 * listener other modules registered (index/tabs 'close'/'closed' etc.). The old window is destroyed
 * with all listeners removed, so app quit / session-save / tab teardown logic never sees it close.
 */
function swapWindow(material: WindowMaterial): void {
  const old = win;
  if (!old || old.isDestroyed()) return;
  const maximized = old.isMaximized();
  const fullscreen = old.isFullScreen();
  const focused = old.isFocused();
  const minimized = old.isMinimized();
  const next = buildWindow(material, old.getNormalBounds());

  for (const view of [chromeView, activeView]) if (view) old.contentView.removeChildView(view);
  for (const event of old.eventNames()) {
    if (typeof event !== 'string') continue;
    for (const listener of old.listeners(event)) {
      if (!ownListeners.has(listener as (...args: never[]) => void)) next.on(event as 'close', listener as () => void);
    }
  }
  old.removeAllListeners();

  // Frame-ful (Mica) and transparent windows report different outer bounds for the same client
  // area on Windows; carry the content rect over so the window doesn't drift on every switch.
  if (!maximized && !fullscreen) next.setContentBounds(old.getContentBounds());
  win = next;
  wireWindow(next);
  attachViews(next);
  if (maximized) next.maximize();
  if (fullscreen) next.setFullScreen(true);
  layout();
  if (focused) next.show();
  else next.showInactive();
  if (minimized) next.minimize();
  const focusTarget = overlayOpen || !activeView ? chromeView : activeView;
  if (focused && focusTarget && !focusTarget.webContents.isDestroyed()) focusTarget.webContents.focus();
  // Let the new window paint before the old one disappears (avoids a flash of desktop).
  setTimeout(() => {
    if (!old.isDestroyed()) old.destroy();
  }, 120);
  sendToChrome(IPC.chromeEvents.maximized, next.isMaximized());
}

export function applyWindowMaterial(material: WindowMaterial): void {
  if (!win || win.isDestroyed()) return;
  const look = windowLook(material);
  if ((look.transparent === true) !== windowTransparent) {
    swapWindow(material);
    return;
  }
  if (windowTransparent) return;
  win.setBackgroundColor(look.backgroundColor ?? OPAQUE_BG);
  if (supportsMaterial()) win.setBackgroundMaterial(look.backgroundMaterial ?? 'none');
}

export function createMainWindow(): BrowserWindow {
  const saved = getStore().get();
  const bounds = saved.bounds && boundsVisible(saved.bounds) ? saved.bounds : null;
  win = buildWindow(getSettings().windowMaterial, bounds);
  const current = win;

  chromeView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'chrome.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Lets the UI see document.visibilityState === 'hidden' when minimized, so polling stops.
      backgroundThrottling: true,
    },
  });
  chromeView.setBackgroundColor(CLEAR_BG);
  const chromeWc = chromeView.webContents;
  chromeWc.setWindowOpenHandler(() => ({ action: 'deny' }));
  chromeWc.on('will-navigate', (event) => event.preventDefault());
  // A reloaded/crashed chrome renderer starts with no overlay holders: never leave it raised above
  // the page (its transparent viewport would swallow every click). Uses the *current* window, which
  // may have been swapped since.
  const resetOverlay = (): void => {
    if (!overlayOpen) return;
    overlayOpen = false;
    if (activeView && win && !win.isDestroyed()) win.contentView.addChildView(activeView);
  };
  chromeWc.on('did-start-loading', resetOverlay);
  chromeWc.on('render-process-gone', () => {
    resetOverlay();
    if (!chromeWc.isDestroyed()) chromeWc.reload();
  });
  current.contentView.addChildView(chromeView);
  wireWindow(current);
  layout();

  let shown = false;
  const show = (): void => {
    if (shown || current.isDestroyed() || win !== current) return;
    shown = true;
    if (saved.maximized) current.maximize();
    current.show();
  };
  current.once('ready-to-show', show);
  chromeWc.once('did-finish-load', show);
  setTimeout(show, 3000);
  void chromeWc.loadFile(join(__dirname, '..', 'renderer', 'chrome', 'index.html')).catch(() => undefined);
  return current;
}

export function getMainWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

export function getChromeView(): WebContentsView | null {
  return chromeView;
}

/** Attach `view` as the single visible tab view (or detach all with null). */
export function showView(view: WebContentsView | null): void {
  if (!win || win.isDestroyed()) return;
  if (activeView && activeView !== view) win.contentView.removeChildView(activeView);
  activeView = view;
  if (view) {
    win.contentView.addChildView(view);
    if (overlayOpen && chromeView) win.contentView.addChildView(chromeView);
  }
  layout();
}

/** Forget a view that is being destroyed without re-laying out. */
export function detachView(view: WebContentsView): void {
  if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
  if (activeView === view) activeView = null;
}

export function setContentBounds(bounds: ContentBounds): void {
  contentBounds = bounds;
  layout();
}

export function setOverlay(open: boolean): void {
  overlayOpen = open;
  if (!win || win.isDestroyed()) return;
  const top = open ? chromeView : activeView;
  if (!top) return;
  win.contentView.addChildView(top);
  // Keyboard input must follow the visible layer: palette/menus need focus while open,
  // the page gets it back once the overlay closes.
  if (!top.webContents.isDestroyed()) top.webContents.focus();
}

export function setHtmlFullscreen(on: boolean): void {
  if (!win || win.isDestroyed()) {
    htmlFullscreen = false;
    return;
  }
  if (on === htmlFullscreen) return;
  if (on) {
    fullscreenBeforeHtml = win.isFullScreen();
    if (overlayOpen) setOverlay(false);
  }
  htmlFullscreen = on;
  const target = on || fullscreenBeforeHtml;
  if (win.isFullScreen() !== target) win.setFullScreen(target);
  layout();
}

export function isHtmlFullscreen(): boolean {
  return htmlFullscreen;
}

export function toggleFullscreen(): void {
  if (!win || win.isDestroyed()) return;
  win.setFullScreen(!win.isFullScreen());
}
