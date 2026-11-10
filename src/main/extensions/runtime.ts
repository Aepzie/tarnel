import { app, type BaseWindow, type BrowserWindow, type Session, type WebContents } from 'electron';
import type { ElectronChromeExtensions } from 'electron-chrome-extensions';
import type { ExtensionAction, ExtensionAnchor, SpaceId } from '../../shared/types';
import { getSpace, listSpaces } from '../spaces';
import { activateTab, closeTab, createTab, getActiveTab, getTabWebContents, tabIdForWebContents } from '../tabs';
import { isInternalUrl } from '../url';
import { getMainWindow } from '../window';
import { staticInfo } from './manifest';
import { attachDnr, forgetDnrSession, loadDnr, registerDnrPreload, unloadDnr } from './dnr';
import { allowedIn, arm, getInstalled, isArmed, listInstalled, runsIn, wantedIn, type InstalledExtension } from './registry';

/**
 * Per-Space extension hosts. `electron-chrome-extensions` (chrome.tabs / windows / action /
 * popups on top of Electron's session.extensions) is imported lazily, the first time a Space
 * session actually has an extension to run — a browser without extensions never loads it.
 */

type Library = typeof import('electron-chrome-extensions');

/** Library internals Vela relies on; the dependency is pinned to an exact version for this. */
interface ActionDetails {
  title?: unknown;
  text?: unknown;
  color?: unknown;
  iconModified?: unknown;
}
interface Internals {
  ctx: {
    store: {
      tabs: Set<WebContents>;
      tabToWindow: WeakMap<WebContents, BaseWindow>;
      addWindow(win: BaseWindow): void;
      lastFocusedWindowId?: number;
    };
    router: {
      handlers: Map<string, { callback: (event: { extension?: Electron.Extension }, ...args: unknown[]) => unknown }>;
      handle(name: string, callback: (event: { extension?: Electron.Extension }, ...args: unknown[]) => unknown, options?: object): void;
      sendEvent(extensionId: string, eventName: string, ...args: unknown[]): void;
    };
  };
  api: {
    permissions: { permissionMap: Map<string, { permissions: string[]; origins: string[] }> };
    browserAction: {
      getState(): { actions: (ActionDetails & { id: string; tabs: Record<string, ActionDetails | undefined> })[] };
      activateClick(details: { extensionId: string; tabId: number; anchorRect: ExtensionAnchor }): void;
      activateContextMenu(details: { extensionId: string; anchorRect: ExtensionAnchor }): void;
      handleCRXRequest(request: { url: string }): Response;
      observers: Set<{ isDestroyed(): boolean; send?(channel: string): void }>;
      popup?: { extensionId: string; destroy(): void };
    };
  };
}

interface Host {
  spaceId: SpaceId;
  session: Session;
  crx: ElectronChromeExtensions | null;
  /** Extension id → directory it was loaded from. */
  loaded: Map<string, string>;
  queue: Promise<void>;
}

const hosts = new Map<Session, Host>();
const tabContents = new Set<WebContents>();
const errors = new Map<string, string>();
const iconCache = new Map<string, string | null>();
const ICON_CACHE_MAX = 200;
let library: Library | null = null;
let onChange: () => void = () => undefined;
/** > 0 while Vela itself drives the library (its selectTab callback must not echo back). */
let internalDepth = 0;
let lastActive: WebContents | null = null;
let backgroundHardening = false;

const internals = (crx: ElectronChromeExtensions): Internals => crx as unknown as Internals;

function changed(): void {
  try {
    onChange();
  } catch {
    /* ignore listener errors */
  }
}

function asVela(fn: () => void): void {
  internalDepth += 1;
  try {
    fn();
  } finally {
    internalDepth -= 1;
  }
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 300) || 'Failed to load';
}

/** Where an extension may send a tab: the web, or extension pages. Never vela://, file:, data:. */
export function extensionMayOpen(url: string): boolean {
  return /^https?:\/\//i.test(url) || url === 'about:blank' || /^chrome-extension:\/\/[a-p]{32}\//i.test(url);
}

function activeContents(): WebContents | null {
  const id = getActiveTab();
  return id === null ? null : getTabWebContents(id);
}

function openTab(spaceId: SpaceId, url: string | undefined, active: boolean): [WebContents, BaseWindow] {
  const win = getMainWindow();
  if (!win) throw new Error('No browser window');
  if (url && !extensionMayOpen(url)) throw new Error('URL not allowed');
  const wc = getTabWebContents(createTab({ url, spaceId, active }));
  if (!wc) throw new Error('Tab could not be created');
  return [wc, win];
}

/** Popups and background pages: links open as tabs of the Space, never vela:// pages. */
function harden(wc: WebContents, spaceId: SpaceId): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (extensionMayOpen(url)) createTab({ url, spaceId, active: true });
    return { action: 'deny' };
  });
  wc.on('will-frame-navigate', (details) => {
    if (isInternalUrl(details.url)) details.preventDefault();
  });
}

/** chrome.tabs.update({ url }) loads directly into the tab; apply the same URL policy as tabs.create. */
function guardNavigation(crx: ElectronChromeExtensions): void {
  const handler = internals(crx).ctx.router.handlers.get('tabs.update');
  if (!handler) return;
  const original = handler.callback;
  handler.callback = (event, ...args) => {
    const props = (typeof args[0] === 'object' ? args[0] : args[1]) as { url?: unknown } | undefined;
    if (typeof props?.url === 'string') {
      let url: string;
      try {
        url = new URL(props.url, event.extension?.url).href;
      } catch {
        throw new Error('Invalid URL');
      }
      if (!extensionMayOpen(url)) throw new Error('URL not allowed');
    }
    return original(event, ...args);
  };
}

/** After a window swap (material change) the library still points at the old window. */
function retarget(host: Host, wc: WebContents): void {
  const win = getMainWindow();
  if (!win || !host.crx) return;
  const store = internals(host.crx).ctx.store;
  if (store.tabToWindow.get(wc) === win) return;
  for (const tab of store.tabs) store.tabToWindow.set(tab, win);
  store.addWindow(win);
  store.lastFocusedWindowId = win.id;
}

function selectIn(host: Host): void {
  const wc = activeContents();
  if (!wc || wc.session !== host.session || !host.crx) return;
  retarget(host, wc);
  const crx = host.crx;
  asVela(() => crx.selectTab(wc));
}

function addTab(host: Host, wc: WebContents): void {
  const win = getMainWindow();
  const crx = host.crx;
  if (!win || !crx || wc.isDestroyed()) return;
  asVela(() => crx.addTab(wc, win));
  // The library marks every added tab active; restore the real one.
  selectIn(host);
}

async function createHost(host: Host): Promise<void> {
  // Lazy CommonJS require (external in the bundle): only evaluated once an extension must run.
  library ??= require('electron-chrome-extensions') as Library;
  const { ElectronChromeExtensions } = library;
  if (host.crx) return;
  // Before the library: its preload freezes `chrome`, ours adds chrome.declarativeNetRequest.
  registerDnrPreload(host.session);
  const crx = new ElectronChromeExtensions({
    session: host.session,
    createTab: async (details) => openTab(host.spaceId, details.url, details.active !== false),
    selectTab: (wc) => {
      if (internalDepth > 0) return;
      const id = tabIdForWebContents(wc.id);
      if (id !== null && id !== getActiveTab()) activateTab(id);
    },
    // Also called when a tab's webContents goes away (sleep, close): only act on live tabs.
    removeTab: (wc) => {
      if (internalDepth > 0 || wc.isDestroyed()) return;
      const id = tabIdForWebContents(wc.id);
      if (id !== null) closeTab(id);
    },
    createWindow: async (details) => {
      const list = Array.isArray(details.url) ? details.url : [details.url];
      const urls = list.length > 0 ? list : [undefined];
      const opened = urls.slice(0, 10).map((url, index) => openTab(host.spaceId, url, index === 0));
      return opened[0]![1];
    },
    removeWindow: () => undefined,
  });
  guardNavigation(crx);
  wireDnr(host, crx);
  internals(crx).api.browserAction.observers.add({ isDestroyed: () => false, send: changed });
  crx.on('browser-action-popup-created', (popup: { browserWindow?: BrowserWindow }) => {
    const wc = popup.browserWindow?.webContents;
    if (wc) harden(wc, host.spaceId);
  });
  if (!backgroundHardening) {
    backgroundHardening = true;
    app.on('web-contents-created', (_event, wc) => {
      const owner = hosts.get(wc.session);
      if (owner?.crx && wc.getType() === 'backgroundPage') harden(wc, owner.spaceId);
    });
  }
  host.crx = crx;
  for (const wc of tabContents) if (wc.session === host.session) addTab(host, wc);
}

/** chrome.declarativeNetRequest: API handlers on the library's router, badge and permission bridge. */
function wireDnr(host: Host, crx: ElectronChromeExtensions): void {
  const { router } = internals(crx).ctx;
  const { permissions } = internals(crx).api;
  attachDnr(host.session, host.spaceId, router, {
    setBadgeText(extensionId, tabId, text) {
      const extension = host.session.extensions.getExtension(extensionId);
      const setter = router.handlers.get('browserAction.setBadgeText');
      if (!extension || !setter) return;
      try {
        void setter.callback({ extension }, { tabId, text });
      } catch {
        /* extension went away */
      }
    },
    grantedOrigins: (extensionId) => permissions.permissionMap.get(extensionId)?.origins ?? [],
    sendEvent: (extensionId, eventName, ...args) => router.sendEvent(extensionId, eventName, ...args),
  });
}

function unload(host: Host, id: string): void {
  host.loaded.delete(id);
  unloadDnr(host.session, id);
  const popup = host.crx ? internals(host.crx).api.browserAction.popup : undefined;
  if (popup?.extensionId === id) popup.destroy();
  try {
    host.session.extensions.removeExtension(id);
  } catch {
    /* already gone */
  }
}

function startWorker(host: Host, extension: Electron.Extension): void {
  const manifest = extension.manifest as { manifest_version?: number; background?: { service_worker?: string } };
  if (manifest.manifest_version !== 3 || !manifest.background?.service_worker) return;
  host.session.serviceWorkers.startWorkerForScope(`chrome-extension://${extension.id}/`).catch(() => undefined);
}

async function reconcile(host: Host): Promise<void> {
  const space = getSpace(host.spaceId);
  if (!space || hosts.get(host.session) !== host) return;
  const wanted = new Map(wantedIn(space).map((entry) => [entry.id, entry]));
  const extensions = host.session.extensions;
  let dirty = false;
  for (const [id, path] of host.loaded) {
    if (wanted.get(id)?.path === path) continue;
    unload(host, id);
    dirty = true;
  }
  if (wanted.size > 0 && !host.crx) await createHost(host);
  for (const entry of wanted.values()) {
    if (host.loaded.has(entry.id)) continue;
    dirty = true;
    try {
      if (extensions.getExtension(entry.id)) extensions.removeExtension(entry.id);
      const extension = await extensions.loadExtension(entry.path);
      if (extension.id !== entry.id) {
        extensions.removeExtension(extension.id);
        throw new Error('The extension ID changed. Remove it and add it again.');
      }
      host.loaded.set(entry.id, entry.path);
      errors.delete(entry.id);
      await loadDnr(host.session, host.spaceId, extension, { installRank: entry.installedAt, unpacked: entry.source === 'unpacked' }).catch(() => null);
      startWorker(host, extension);
    } catch (error) {
      errors.set(entry.id, messageOf(error));
    }
  }
  if (dirty) changed();
}

function sync(host: Host): Promise<void> {
  host.queue = host.queue.then(() => reconcile(host)).catch(() => undefined);
  return host.queue;
}

// ---------------------------------------------------------------------------
// public API

export function onRuntimeChanged(cb: () => void): void {
  onChange = cb;
}

/**
 * Track a Space session. Returns a promise that settles once the extensions it should run are
 * loaded (so the first page gets content scripts), or null when it runs none.
 */
export function registerSession(session: Session, spaceId: SpaceId): Promise<void> | null {
  if (hosts.has(session)) return null;
  const host: Host = { spaceId, session, crx: null, loaded: new Map(), queue: Promise.resolve() };
  hosts.set(session, host);
  const space = getSpace(spaceId);
  if (!space || wantedIn(space).length === 0) return null;
  return sync(host);
}

export function forgetSession(session: Session): void {
  hosts.delete(session);
  forgetDnrSession(session);
}

export function syncAll(): Promise<void> {
  return Promise.all([...hosts.values()].map(sync)).then(() => undefined);
}

export function attachTab(wc: WebContents): void {
  tabContents.add(wc);
  wc.once('destroyed', () => {
    tabContents.delete(wc);
    if (lastActive === wc) lastActive = null;
  });
  const host = hosts.get(wc.session);
  if (host?.crx) addTab(host, wc);
}

/** Tell the extension system about tab switches. Returns true when the active tab changed. */
export function noteActiveTab(): boolean {
  const wc = activeContents();
  if (wc === lastActive) return false;
  lastActive = wc;
  const host = wc ? hosts.get(wc.session) : undefined;
  if (host) selectIn(host);
  return true;
}

export function loadError(id: string): string | null {
  return errors.get(id) ?? null;
}

export function clearError(id: string): void {
  errors.delete(id);
}

/** Unload from every Space so the next sync loads it fresh from disk. */
export function unloadEverywhere(id: string): void {
  for (const host of hosts.values()) if (host.loaded.has(id)) unload(host, id);
  for (const key of iconCache.keys()) if (key.startsWith(`${id}:`)) iconCache.delete(key);
}

function cssColor(value: unknown): string | null {
  if (typeof value === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value)) return value;
  if (Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    const [r, g, b, a] = value as number[];
    return `rgba(${r}, ${g}, ${b}, ${Math.round((a! / 255) * 100) / 100})`;
  }
  return null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Dynamic action icon (chrome.action.setIcon); null = the manifest icon is current. */
async function actionIcon(
  api: Internals['api']['browserAction'],
  id: string,
  tabId: number,
  tabModified: unknown,
  globalModified: unknown,
): Promise<string | null> {
  const perTab = typeof tabModified === 'number';
  if (!perTab && typeof globalModified !== 'number') return null;
  const key = perTab ? `${id}:${tabId}:${tabModified}` : `${id}:g:${String(globalModified)}`;
  const cached = iconCache.get(key);
  if (cached !== undefined) return cached;
  let url: string | null = null;
  try {
    const query = perTab ? `?tabId=${tabId}` : '';
    const response = api.handleCRXRequest({ url: `crx://extension-icon/${id}/32/2${query}` });
    if (response.ok) url = `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
  } catch {
    url = null;
  }
  if (iconCache.size >= ICON_CACHE_MAX) iconCache.clear();
  iconCache.set(key, url);
  return url;
}

/** 'On click' extensions allowed in the Space but not loaded yet: their button loads them. */
function waitingForClick(host: Host | undefined): InstalledExtension[] {
  const space = host ? getSpace(host.spaceId) : undefined;
  if (!space) return [];
  return listInstalled().filter((entry) => entry.siteAccess === 'click' && !isArmed(entry.id) && allowedIn(entry, space));
}

function waitingAction(entry: InstalledExtension): ExtensionAction {
  return { id: entry.id, title: `${entry.name} — click to run`, badgeText: '', badgeColor: null, icon: staticInfo(entry.path).icon };
}

/** Action buttons of the extensions running in the active tab's Space. */
export async function activeActions(): Promise<ExtensionAction[]> {
  const wc = activeContents();
  const host = wc ? hosts.get(wc.session) : undefined;
  const waiting = waitingForClick(host).map(waitingAction);
  if (!wc || !host?.crx || host.loaded.size === 0) return waiting;
  const api = internals(host.crx).api.browserAction;
  let actions: ReturnType<typeof api.getState>['actions'] = [];
  try {
    actions = api.getState().actions;
  } catch {
    actions = [];
  }
  const byId = new Map(actions.map((action) => [action.id, action]));
  const live = await Promise.all(
    [...host.loaded].map(async ([id, path]): Promise<ExtensionAction> => {
      const action = byId.get(id);
      const tab = action?.tabs[String(wc.id)];
      const icon = await actionIcon(api, id, wc.id, tab?.iconModified, action?.iconModified);
      return {
        id,
        title: text(tab?.title ?? action?.title) || getInstalled(id)?.name || id,
        badgeText: text(tab?.text ?? action?.text).slice(0, 6),
        badgeColor: cssColor(tab?.color ?? action?.color),
        icon: icon ?? staticInfo(path).icon,
      };
    }),
  );
  return [...live, ...waiting];
}

/** Site access 'On click': the first click on its button loads it (for this launch), then runs the click. */
async function armOnClick(host: Host | undefined, id: string): Promise<void> {
  if (!host || host.loaded.has(id)) return;
  if (!waitingForClick(host).some((entry) => entry.id === id)) return;
  arm(id);
  await syncAll();
  changed();
}

export async function activateAction(id: string, anchor: ExtensionAnchor, kind: 'click' | 'contextmenu'): Promise<void> {
  const before = activeContents();
  await armOnClick(before ? hosts.get(before.session) : undefined, id);
  const wc = activeContents();
  const host = wc ? hosts.get(wc.session) : undefined;
  if (!wc || !host?.crx || !host.loaded.has(id)) throw new Error('Extension is not running in this Space');
  selectIn(host);
  const api = internals(host.crx).api.browserAction;
  if (kind === 'contextmenu') api.activateContextMenu({ extensionId: id, anchorRect: anchor });
  else api.activateClick({ extensionId: id, tabId: wc.id, anchorRect: anchor });
}

/** Open the options page in a Space that runs the extension (preferring `preferred`). */
export function openOptionsPage(id: string, preferred: SpaceId | null): void {
  const entry = getInstalled(id);
  if (!entry) throw new Error('Extension is not installed');
  const page = staticInfo(entry.path).optionsPage;
  if (!page) throw new Error('This extension has no options page');
  const spaces = listSpaces().filter((space) => runsIn(entry, space));
  const target = spaces.find((space) => space.id === preferred) ?? spaces[0];
  if (!target) throw new Error('Turn the extension on in a Space first');
  createTab({ url: `chrome-extension://${id}/${page}`, spaceId: target.id, active: true });
}
