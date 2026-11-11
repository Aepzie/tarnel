import { app, BaseWindow, WebContentsView, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import { splitGeometry } from '../shared/split-layout';
import type { ContentBounds, WindowMaterial } from '../shared/types';
import { themeBackdrop } from './page-theme';
import { getSettings } from './settings';
import { emulateDragSnap } from './snap';
import { createStore, type JsonStore } from './store';

interface WindowFile {
  bounds: Rectangle | null;
  maximized: boolean;
}

const TAB_RADIUS = 12;

let win: BaseWindow | null = null;
let chromeView: WebContentsView | null = null;
/** The focused page view: gets keyboard focus back after overlays, goes HTML-fullscreen. */
let activeView: WebContentsView | null = null;
/** Every attached page view in pane order (just `activeView` unless a split view is shown). */
let visibleViews: WebContentsView[] = [];
let splitRatios = { x: 0.5, y: 0.5 };
let contentBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
let overlayOpen = false;
/** Chrome raised without taking keyboard focus (split pane toolbar under the pointer). */
let peekOpen = false;
let htmlFullscreen = false;
/** Floating page view above everything (Peek), placed by `floatingPlace` from the page area. */
let floatingView: WebContentsView | null = null;
let floatingPlace: ((area: ContentBounds) => ContentBounds) | null = null;
/** Window fullscreen state (F11) before a page entered HTML fullscreen. */
let fullscreenBeforeHtml = false;
let store: JsonStore<WindowFile> | null = null;
/** Views beside the pages (web panels, src/main/panels): stacked above the pages, below a raised chrome. */
let sideViews: () => WebContentsView[] = () => [];

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
  for (const view of sideViews()) view.setVisible(!htmlFullscreen);
  if (floatingView && floatingPlace) {
    setRadius(floatingView, TAB_RADIUS);
    floatingView.setBounds(roundedBounds(floatingPlace(contentBounds)));
  }
  if (!activeView) return;
  if (htmlFullscreen) {
    setRadius(activeView, 0);
    activeView.setBounds({ x: 0, y: 0, ...size });
    return;
  }
  if (visibleViews.length < 2) {
    setRadius(activeView, TAB_RADIUS);
    activeView.setBounds(roundedBounds(contentBounds));
    return;
  }
  const { panes } = splitGeometry(roundedBounds(contentBounds), visibleViews.length, splitRatios.x, splitRatios.y);
  visibleViews.forEach((view, index) => {
    const pane = panes[index];
    if (!pane) return;
    setRadius(view, TAB_RADIUS);
    view.setBounds(roundedBounds(pane));
  });
}

function roundedBounds(bounds: ContentBounds): Rectangle {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  };
}

/** Page views above the chrome (focused one last), then the chrome again while it is raised. */
function restack(target: BaseWindow): void {
  for (const view of visibleViews) if (view !== activeView) target.contentView.addChildView(view);
  if (activeView) target.contentView.addChildView(activeView);
  for (const view of sideViews()) target.contentView.addChildView(view);
  if ((overlayOpen || peekOpen) && chromeView) target.contentView.addChildView(chromeView);
  if (floatingView) target.contentView.addChildView(floatingView);
}

/** Bounds the window will open with at the next launch (null = default placement). Safe before app 'ready'. */
export function savedWindowBounds(): Rectangle | null {
  return getStore().get().bounds;
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

type WindowLook = Pick<Electron.BaseWindowConstructorOptions, 'backgroundColor' | 'backgroundMaterial' | 'transparent'>;

const CLEAR_BG = '#00000000';

/**
 * 'none' = fully transparent window: the desktop shows (unblurred) around the islands.
 * Mica/Acrylic = opaque-to-DWM window with a system backdrop. `transparent` is construction-only,
 * so switching between the two families recreates the window (see swapWindow). On Windows a
 * transparent window gets no WS_THICKFRAME, so no native Snap: see emulateDragSnap.
 */
function windowLook(material: WindowMaterial): WindowLook {
  if (material === 'none') return { transparent: true, backgroundColor: CLEAR_BG };
  if (!supportsMaterial()) return { backgroundColor: themeBackdrop() };
  return { backgroundColor: CLEAR_BG, backgroundMaterial: material };
}

/** Handlers registered by this module on the current window (others' listeners get migrated). */
const ownListeners = new Set<(...args: never[]) => void>();
let windowTransparent = false;

function own<T extends (...args: never[]) => void>(fn: T): T {
  ownListeners.add(fn);
  return fn;
}

/**
 * Window / taskbar icon for unpackaged runs (`npm run dev`), where the process is electron.exe and
 * would otherwise show Electron's icon. Packaged builds take it from the executable / .desktop entry.
 */
function devWindowIcon(): string | undefined {
  if (app.isPackaged || process.platform === 'darwin') return undefined;
  return join(app.getAppPath(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icons/512.png');
}

/**
 * A BaseWindow, not a BrowserWindow: every pixel is drawn by our WebContentsViews, and a
 * BrowserWindow's own (never loaded) webContents still costs a whole renderer process.
 */
function buildWindow(material: WindowMaterial, bounds: Rectangle | null): BaseWindow {
  const look = windowLook(material);
  windowTransparent = look.transparent === true;
  return new BaseWindow({
    ...(bounds ?? { width: 1280, height: 820 }),
    minWidth: 640,
    minHeight: 400,
    frame: false,
    show: false,
    resizable: true,
    ...look,
    title: 'Vela',
    icon: devWindowIcon(),
  });
}

/** Per-window event wiring (layout, persistence, maximized/fullscreen state). */
function wireWindow(current: BaseWindow): void {
  ownListeners.clear();
  current.on('resize', own(layout));
  current.on('resized', own(saveBounds));
  current.on('moved', own(saveBounds));
  if (process.platform === 'win32' && windowTransparent) current.on('moved', own(() => emulateDragSnap(current) && saveBounds()));
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
      visibleViews = [];
      htmlFullscreen = false;
      overlayOpen = false;
      peekOpen = false;
      floatingView = null;
      floatingPlace = null;
    }),
  );
}

/** Re-add views in layer order: chrome base, page views on top, chrome again when raised. */
function attachViews(target: BaseWindow): void {
  if (chromeView) target.contentView.addChildView(chromeView);
  restack(target);
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

  for (const view of [chromeView, ...visibleViews, ...sideViews(), floatingView]) if (view) old.contentView.removeChildView(view);
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
  win.setBackgroundColor(look.backgroundColor ?? themeBackdrop());
  if (supportsMaterial()) win.setBackgroundMaterial(look.backgroundMaterial ?? 'none');
}

/** Re-tints the opaque window background (no-material platforms) after a theme change. */
export function refreshWindowTheme(): void {
  applyWindowMaterial(getSettings().windowMaterial);
}

export function createMainWindow(): BaseWindow {
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
    if (!overlayOpen && !peekOpen) return;
    overlayOpen = false;
    peekOpen = false;
    if (win && !win.isDestroyed()) restack(win);
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
  chromeWc.once('did-finish-load', show);
  setTimeout(show, 3000);
  void chromeWc.loadFile(join(__dirname, '..', 'renderer', 'chrome', 'index.html')).catch(() => undefined);
  return current;
}

export function getMainWindow(): BaseWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

export function getChromeView(): WebContentsView | null {
  return chromeView;
}

/** Attach `view` as the single visible tab view (or detach all with null). */
export function showView(view: WebContentsView | null): void {
  showViews(view ? [view] : [], view);
}

/**
 * Show `views` side by side in pane order (a single view fills the viewport as usual), `focused`
 * being the active one. Views no longer listed are detached; an unchanged set is only re-laid out.
 */
export function showViews(views: WebContentsView[], focused: WebContentsView | null, ratios?: { x: number; y: number }): void {
  if (!win || win.isDestroyed()) return;
  const next = focused && !views.includes(focused) ? [...views, focused] : views;
  for (const view of visibleViews) if (!next.includes(view)) win.contentView.removeChildView(view);
  // Panes never overlap, so moving focus between them must not re-stack (that would cancel the press).
  const changed = next.length !== visibleViews.length || next.some((view, i) => view !== visibleViews[i]);
  visibleViews = next;
  activeView = focused;
  if (ratios) splitRatios = ratios;
  if (changed) restack(win);
  layout();
}

/** Live divider drag: re-place the visible panes, nothing else. */
export function setSplitRatios(x: number, y: number): void {
  splitRatios = { x, y };
  if (visibleViews.length > 1) layout();
}

/** Forget a view that is being destroyed without re-laying out. */
export function detachView(view: WebContentsView): void {
  if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
  visibleViews = visibleViews.filter((candidate) => candidate !== view);
  if (activeView === view) activeView = null;
}

/** Registers the provider of side views (web panels); `restackWindow` re-applies the layer order. */
export function setSideViewsProvider(provider: () => WebContentsView[]): void {
  sideViews = provider;
}

export function restackWindow(): void {
  if (!win || win.isDestroyed()) return;
  restack(win);
  layout();
}

export function setContentBounds(bounds: ContentBounds): void {
  contentBounds = bounds;
  layout();
}

export function isOverlayOpen(): boolean {
  return overlayOpen;
}

export function setOverlay(open: boolean): void {
  overlayOpen = open;
  if (!win || win.isDestroyed()) return;
  restack(win);
  const top = floatingView ?? (open ? chromeView : activeView);
  // Keyboard input must follow the visible layer: palette/menus need focus while open,
  // the page gets it back once the overlay closes. Never pull focus back from another window
  // (an extension popup would close when a tooltip appears).
  if (top && !top.webContents.isDestroyed() && win?.isFocused()) top.webContents.focus();
}

/** Raise the chrome above the pages without moving keyboard focus (hover surfaces over a pane). */
export function setPeek(open: boolean): void {
  if (peekOpen === open) return;
  peekOpen = open;
  if (win && !win.isDestroyed()) restack(win);
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
    setPeek(false);
    // In a split the fullscreen pane must cover its siblings.
    if (activeView && visibleViews.length > 1) win.contentView.addChildView(activeView);
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

/**
 * Show `view` floating above the pages and the raised chrome (Peek), or remove it with null. The
 * caller keeps the chrome raised (overlay) while it is shown so the dimmed backdrop is visible.
 */
export function setFloatingView(view: WebContentsView | null, place?: (area: ContentBounds) => ContentBounds): void {
  if (floatingView && floatingView !== view && win && !win.isDestroyed()) win.contentView.removeChildView(floatingView);
  floatingView = view;
  floatingPlace = view ? (place ?? null) : null;
  if (!win || win.isDestroyed()) return;
  restack(win);
  layout();
}

export function getContentBounds(): ContentBounds {
  return contentBounds;
}
