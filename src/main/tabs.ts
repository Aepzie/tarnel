import { WebContentsView, type BaseWindow, type NavigationEntry, type WebContents } from 'electron';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import { isLoneStartPage } from '../shared/tab-close';
import type { BrowserState, ContentBounds, SpaceId, TabGroupId, TabMediaDevices, TabState } from '../shared/types';
import { rememberFavicon } from './favicons';
import { recordVisit, updateTitle } from './history';
import { upgradeToHttps } from './privacy';
import { rendererMemoryKB } from './perf/metrics';
import type { SleepCandidate } from './perf/sleeper';
import { getSettings } from './settings';
import { getActiveSpaceId, getSpace, getSpaceSession, listSpaces, onSpacesChanged, removeSpace, setActiveSpaceId, whenSessionReady } from './spaces';
import { bindGroupModel, clusterGroups, getGroup, groupsInOrder, pruneGroups, restoreGroup, savedGroup, type SavedGroup } from './tab-groups';
import { NEWTAB_URL, isInternalUrl, isOpenableFromWeb, isSecureUrl, resolveInput } from './url';
import * as windowLayer from './window';
import { bindSplitModel, clusterSplits, detachFromSplit, isOnScreen, restoreSplits, savedSplit, splitIdOf, splitOf, splitsInOrder, unitOf, type SavedSplit } from './split';
import { onPaneFocus, trackPanes, type Pane } from './split-panes';
import { forgetTab as forgetTabMedia, isMicActive, onTabMediaChanged, restoreTabMediaDevices, tabMediaDevices } from './audio-devices/state';
import { forgetTabAudio, onTabAudioChanged, restoreTabAudio, tabAudioSettings } from './audio-mixer/state';
import type { TabAudioSettings } from '../shared/audio-mixer';
import { attachViewBackdrop } from './page-theme';

export interface SavedTab {
  url: string;
  title: string;
  favicon: string | null;
  spaceId: SpaceId;
  pinned: boolean;
  active: boolean;
  group?: SavedGroup;
  split?: SavedSplit;
  devices?: TabMediaDevices;
  audio?: TabAudioSettings;
}

export interface CreateTabOpts {
  url?: string;
  spaceId?: SpaceId;
  active?: boolean;
  asleep?: boolean;
  pinned?: boolean;
  title?: string;
  favicon?: string | null;
  /** Insert directly after this tab instead of appending. */
  afterId?: number;
  /** Join this group (same space only). Defaults to the group of `afterId`'s tab. */
  groupId?: TabGroupId | null;
}

interface Tab {
  id: number;
  spaceId: SpaceId;
  view: WebContentsView | null;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  audible: boolean;
  muted: boolean;
  pinned: boolean;
  blockedCount: number;
  zoom: number;
  lastActiveAt: number;
  /** Original URL while the vela://error page is shown in its place. */
  errorUrl: string | null;
  findText: string;
  /** Navigation history captured when put to sleep, restored on wake. */
  savedHistory: { entries: NavigationEntry[]; index: number } | null;
  /** Private memory the tab's renderer gave back when it was put to sleep (KB); null = unknown. */
  freedKB: number | null;
  groupId: TabGroupId | null;
}

type WebContentsHook = (wc: WebContents, tabId: number) => void;

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const CLOSED_STACK_MAX = 20;
const ERROR_ABORTED = -3;
const ERROR_PROXY_FAILED = -130;
const PAGES_PRELOAD = join(__dirname, '..', 'preload', 'pages.js');

const tabs = new Map<number, Tab>();
let order: number[] = [];
let activeTabId: number | null = null;
const activeBySpace = new Map<SpaceId, number>();
const wcToTab = new Map<number, number>();
const closedStack: { url: string; spaceId: SpaceId }[] = [];
const stateListeners = new Set<() => void>();
const wcHooks: WebContentsHook[] = [];
let nextId = 1;
let emitPending = false;
let spacesHooked = false;

// ---------------------------------------------------------------------------
// helpers

function scheduleEmit(): void {
  if (emitPending) return;
  emitPending = true;
  setImmediate(() => {
    emitPending = false;
    pruneGroups(new Set([...tabs.values()].flatMap((tab) => (tab.groupId ? [tab.groupId] : []))));
    for (const cb of stateListeners) {
      try {
        cb();
      } catch {
        /* ignore listener errors */
      }
    }
  });
}

function liveWc(tab: Tab | undefined): WebContents | null {
  const wc = tab?.view?.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}

function isEphemeral(spaceId: SpaceId): boolean {
  return getSpace(spaceId)?.ephemeral === true;
}

function tabsInSpace(spaceId: SpaceId): Tab[] {
  return order.map((id) => tabs.get(id)!).filter((t) => t.spaceId === spaceId);
}

/** Keep pinned tabs first, every group's tabs together and split partners adjacent, otherwise preserving relative order. */
function normalizeOrder(): void {
  const pinnedFirst = [...order.filter((id) => tabs.get(id)?.pinned), ...order.filter((id) => !tabs.get(id)?.pinned)];
  order = clusterSplits(clusterGroups(pinnedFirst, groupOf));
}

function groupOf(id: number): TabGroupId | null {
  return tabs.get(id)?.groupId ?? null;
}

function errorPageUrl(code: number | string, desc: string, url: string): string {
  const params = new URLSearchParams({ code: String(code), desc, url });
  return `vela://error/?${params.toString()}`;
}

function load(wc: WebContents, url: string): void {
  wc.loadURL(url).catch(() => undefined);
}

/**
 * Load web content only once the space session's proxy is applied, so no request can leak
 * outside the configured proxy. On proxy failure show the error page instead.
 */
function loadInTab(tab: Tab, wc: WebContents, url: string, navigate: () => Promise<unknown> = () => wc.loadURL(url)): void {
  if (isInternalUrl(url)) {
    navigate().catch(() => undefined);
    return;
  }
  const view = tab.view;
  const stillCurrent = (): boolean => !wc.isDestroyed() && tab.view === view && tabs.get(tab.id) === tab;
  whenSessionReady(tab.spaceId).then(
    () => {
      if (stillCurrent()) navigate().catch(() => undefined);
    },
    () => {
      if (!stillCurrent()) return;
      tab.errorUrl = url;
      tab.url = url;
      load(wc, errorPageUrl(ERROR_PROXY_FAILED, 'ERR_PROXY_CONNECTION_FAILED', url));
      scheduleEmit();
    },
  );
}

function setTabUrl(tab: Tab, url: string): void {
  if (url.startsWith('vela://error/') && tab.errorUrl) return;
  tab.url = url;
  tab.errorUrl = null;
}

// ---------------------------------------------------------------------------
// webContents lifecycle

function wireEvents(tab: Tab, view: WebContentsView): void {
  const wc = view.webContents;
  const wcId = wc.id;
  const current = (): boolean => tabs.get(tab.id) === tab && tab.view === view;

  wc.on('destroyed', () => {
    if (wcToTab.get(wcId) === tab.id) wcToTab.delete(wcId);
  });
  wc.on('page-title-updated', (_e, title) => {
    if (!current()) return;
    tab.title = title;
    if (!isEphemeral(tab.spaceId) && !isInternalUrl(tab.url)) updateTitle(tab.url, title);
    scheduleEmit();
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    if (!current()) return;
    tab.favicon = favicons.find((f) => /^(https?:|data:image\/)/i.test(f)) ?? null;
    const remote = favicons.find((f) => /^https?:\/\//i.test(f));
    if (remote && /^https?:\/\//i.test(tab.url) && getSpace(tab.spaceId)?.ephemeral === false) {
      rememberFavicon(tab.url, remote, wc.session);
    }
    scheduleEmit();
  });
  wc.on('did-start-loading', () => {
    if (!current()) return;
    tab.loading = true;
    scheduleEmit();
  });
  wc.on('did-stop-loading', () => {
    if (!current()) return;
    tab.loading = false;
    scheduleEmit();
  });
  wc.on('did-start-navigation', (details) => {
    if (!current() || !details.isMainFrame || details.isSameDocument) return;
    tab.blockedCount = 0;
    scheduleEmit();
  });
  wc.on('did-navigate', (_e, url) => {
    if (!current()) return;
    setTabUrl(tab, url);
    if (Math.abs(wc.getZoomFactor() - tab.zoom) > 0.001) wc.setZoomFactor(tab.zoom);
    if (!isEphemeral(tab.spaceId) && !isInternalUrl(url)) recordVisit(url, wc.getTitle());
    scheduleEmit();
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!current() || !isMainFrame) return;
    setTabUrl(tab, url);
    if (!isEphemeral(tab.spaceId) && !isInternalUrl(url)) recordVisit(url, wc.getTitle());
    scheduleEmit();
  });
  wc.on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => {
    if (!current() || !isMainFrame || code === ERROR_ABORTED || validatedURL.startsWith('vela://error/')) return;
    tab.errorUrl = validatedURL;
    tab.url = validatedURL;
    load(wc, errorPageUrl(code, desc, validatedURL));
  });
  wc.on('render-process-gone', (_e, details) => {
    if (!current() || details.reason === 'clean-exit') return;
    const url = tab.errorUrl ?? tab.url;
    tab.loading = false;
    if (isOnScreen(tab.id)) {
      tab.errorUrl = url;
      load(wc, errorPageUrl('crashed', details.reason, url));
    } else {
      // Background tab: drop the dead renderer; it reloads cleanly when next activated.
      tab.errorUrl = null;
      tab.url = url;
      setImmediate(() => {
        if (current()) destroyView(tab, false);
        scheduleEmit();
      });
    }
    scheduleEmit();
  });
  wc.on('found-in-page', (_e, result) => {
    if (!current()) return;
    windowLayer.sendToChrome(IPC.chromeEvents.findResult, {
      tabId: tab.id,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
    });
  });
  wc.on('audio-state-changed', (event) => {
    if (!current()) return;
    tab.audible = event.audible;
    scheduleEmit();
  });
  wc.on('enter-html-full-screen', () => {
    if (current() && tab.id === activeTabId) windowLayer.setHtmlFullscreen(true);
  });
  wc.on('leave-html-full-screen', () => {
    if (current() && windowLayer.isHtmlFullscreen()) windowLayer.setHtmlFullscreen(false);
  });
  wc.on('will-frame-navigate', (details) => {
    // Web content may never navigate (any frame) into privileged vela:// pages.
    const from = details.initiator?.url ?? wc.getURL();
    if (isInternalUrl(details.url) && !isInternalUrl(from)) details.preventDefault();
  });
  wc.on('will-navigate', (details) => {
    if (!details.isMainFrame || details.isSameDocument || !getSettings().httpsOnly) return;
    const upgraded = upgradeToHttps(details.url);
    if (upgraded === details.url) return;
    details.preventDefault();
    loadInTab(tab, wc, upgraded);
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());

  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'new-window') {
      if (!isOpenableFromWeb(url)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          webPreferences: { session: wc.session, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true },
        },
      };
    }
    const allowed = isOpenableFromWeb(url) || (isInternalUrl(url) && isInternalUrl(wc.getURL()));
    if (allowed) createTab({ url, spaceId: tab.spaceId, active: disposition !== 'background-tab' && tab.id === activeTabId, afterId: tab.id });
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => {
    child.webContents.setWindowOpenHandler(({ url }) => {
      if (isOpenableFromWeb(url)) createTab({ url, spaceId: tab.spaceId, active: true });
      return { action: 'deny' };
    });
    child.webContents.on('will-attach-webview', (event) => event.preventDefault());
    child.webContents.on('will-frame-navigate', (details) => {
      if (isInternalUrl(details.url)) details.preventDefault();
    });
    child.webContents.on('will-navigate', (details) => {
      if (!details.isMainFrame || details.isSameDocument || !getSettings().httpsOnly) return;
      const upgraded = upgradeToHttps(details.url);
      if (upgraded === details.url) return;
      details.preventDefault();
      void child.webContents.loadURL(upgraded);
    });
  });
}

function createView(tab: Tab): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      session: getSpaceSession(tab.spaceId),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      // Sandboxed, so no Node anywhere: this only lets the fingerprint session preload run in
      // iframes too. The pages and cosmetic-filter preloads ignore subframes.
      nodeIntegrationInSubFrames: true,
      preload: PAGES_PRELOAD,
      backgroundThrottling: true,
      spellcheck: false,
    },
  });
  tab.view = view;
  attachViewBackdrop(view, tab.errorUrl ?? tab.url);
  const wc = view.webContents;
  wcToTab.set(wc.id, tab.id);
  wireEvents(tab, view);
  if (tab.muted) wc.setAudioMuted(true);
  for (const hook of wcHooks) {
    try {
      hook(wc, tab.id);
    } catch {
      /* ignore hook errors */
    }
  }
  return view;
}

/** Create the view (if needed) and load the tab's URL / restored history. */
function wake(tab: Tab): WebContents {
  tab.lastActiveAt = Date.now();
  const existing = liveWc(tab);
  if (existing && !existing.isCrashed()) return existing;
  if (existing) destroyView(tab, false);
  tab.freedKB = null;
  const wc = createView(tab).webContents;
  const saved = tab.savedHistory;
  tab.savedHistory = null;
  const url = tab.errorUrl ?? tab.url;
  if (saved && saved.entries.length > 0 && !tab.errorUrl) {
    loadInTab(tab, wc, url, () =>
      wc.navigationHistory.restore({ entries: saved.entries, index: saved.index }).catch(() => wc.loadURL(url)),
    );
  } else {
    loadInTab(tab, wc, url);
  }
  return wc;
}

function destroyView(tab: Tab, keepHistory: boolean): void {
  const view = tab.view;
  if (!view) return;
  const wc = view.webContents;
  if (keepHistory && !wc.isDestroyed()) {
    try {
      tab.savedHistory = {
        entries: wc.navigationHistory.getAllEntries(),
        index: wc.navigationHistory.getActiveIndex(),
      };
    } catch {
      tab.savedHistory = null;
    }
  }
  tab.view = null;
  tab.loading = false;
  tab.audible = false;
  windowLayer.detachView(view);
  wcToTab.delete(wc.id);
  if (!wc.isDestroyed()) wc.close();
}

// ---------------------------------------------------------------------------
// public API

export function initTabs(win: BaseWindow): void {
  if (!spacesHooked) {
    spacesHooked = true;
    onSpacesChanged(scheduleEmit);
  }
  win.on('closed', () => {
    if (windowLayer.isHtmlFullscreen()) windowLayer.setHtmlFullscreen(false);
    trackPanes([]);
    for (const tab of tabs.values()) destroyView(tab, true);
  });
  // Re-init after a window was recreated (macOS activate): show the active tab again.
  if (activeTabId !== null && tabs.has(activeTabId)) activateTab(activeTabId);
}

export function onTabWebContents(hook: WebContentsHook): void {
  wcHooks.push(hook);
}

export function onStateChanged(cb: () => void): void {
  stateListeners.add(cb);
}

export function createTab(opts: CreateTabOpts = {}): number {
  const spaceId = opts.spaceId && getSpace(opts.spaceId) ? opts.spaceId : getActiveSpaceId();
  const groupId = opts.groupId === undefined ? (opts.afterId === undefined ? null : groupOf(opts.afterId)) : opts.groupId;
  const tab: Tab = {
    id: nextId++,
    spaceId,
    view: null,
    url: opts.url || NEWTAB_URL,
    title: opts.title ?? '',
    favicon: opts.favicon ?? null,
    loading: false,
    audible: false,
    muted: false,
    pinned: opts.pinned === true,
    blockedCount: 0,
    zoom: 1,
    lastActiveAt: Date.now(),
    errorUrl: null,
    findText: '',
    savedHistory: null,
    freedKB: null,
    groupId: !opts.pinned && groupId && getGroup(groupId)?.spaceId === spaceId ? groupId : null,
  };
  tabs.set(tab.id, tab);
  const afterIndex = opts.afterId === undefined ? -1 : order.indexOf(opts.afterId);
  if (afterIndex === -1) order.push(tab.id);
  else order.splice(afterIndex + 1, 0, tab.id);
  normalizeOrder();

  const active = opts.active !== false;
  if (active) activateTab(tab.id);
  else if (!opts.asleep) wake(tab);
  scheduleEmit();
  return tab.id;
}

export function activateTab(id: number): void {
  const tab = tabs.get(id);
  if (!tab) return;
  const now = Date.now();
  const prev = activeTabId === null ? undefined : tabs.get(activeTabId);
  if (prev && prev !== tab) {
    prev.lastActiveAt = now;
    if (windowLayer.isHtmlFullscreen()) windowLayer.setHtmlFullscreen(false);
  }
  activeTabId = id;
  activeBySpace.set(tab.spaceId, id);
  tab.lastActiveAt = now;
  if (getActiveSpaceId() !== tab.spaceId) setActiveSpaceId(tab.spaceId);
  const wc = wake(tab);
  if (Math.abs(wc.getZoomFactor() - tab.zoom) > 0.001) wc.setZoomFactor(tab.zoom);
  showActive();
  // The start page owns its search box, so it takes keyboard focus like a web page (unless the palette is up).
  if (!isInternalUrl(tab.url) || (tab.url.startsWith(NEWTAB_URL) && !windowLayer.isOverlayOpen())) wc.focus();
  scheduleEmit();
}

/** Attach the active tab's view, or every pane of its split (partners wake together). */
function showActive(): void {
  const tab = activeTabId === null ? undefined : tabs.get(activeTabId);
  const split = tab ? splitOf(tab.id) : undefined;
  if (!tab || !split) {
    trackPanes([]);
    windowLayer.showView(tab?.view ?? null);
    return;
  }
  const panes: Pane[] = [];
  for (const id of split.tabIds) {
    const member = tabs.get(id);
    if (!member) continue;
    const wc = wake(member);
    if (Math.abs(wc.getZoomFactor() - member.zoom) > 0.001) wc.setZoomFactor(member.zoom);
    if (member.view) panes.push({ tabId: id, view: member.view });
  }
  windowLayer.showViews(
    panes.map((pane) => pane.view),
    tab.view,
    { x: split.ratioX, y: split.ratioY },
  );
  trackPanes(panes);
}

function closeTabInternal(id: number, replace: boolean): void {
  const tab = tabs.get(id);
  if (!tab) return;
  const siblings = tabsInSpace(tab.spaceId);
  const index = siblings.indexOf(tab);
  const url = tab.errorUrl ?? tab.url;
  if (url !== NEWTAB_URL) {
    closedStack.push({ url, spaceId: tab.spaceId });
    if (closedStack.length > CLOSED_STACK_MAX) closedStack.shift();
  }
  const wasOnScreen = isOnScreen(id);
  const split = detachFromSplit(id);
  tabs.delete(id);
  order = order.filter((tid) => tid !== id);
  if (activeBySpace.get(tab.spaceId) === id) activeBySpace.delete(tab.spaceId);
  destroyView(tab, false);
  forgetTabMedia(id);
  forgetTabAudio(id);

  if (activeTabId !== id && wasOnScreen) showActive();
  if (activeTabId === id) {
    activeTabId = null;
    if (windowLayer.isHtmlFullscreen()) windowLayer.setHtmlFullscreen(false);
    // Closing a pane hands focus to its split partner, which keeps the remaining panes together.
    const partner = split?.tabIds.find((tid) => tabs.has(tid));
    const neighbor = (partner === undefined ? undefined : tabs.get(partner)) ?? siblings[index + 1] ?? siblings[index - 1];
    if (neighbor) activateTab(neighbor.id);
    else if (replace && isEphemeral(tab.spaceId) && listSpaces().length > 1) {
      // Closing the last tab of a burner space discards the whole space.
      windowLayer.showView(null);
      removeSpaceWithTabs(tab.spaceId).catch(() => createTab({ spaceId: getActiveSpaceId(), active: true }));
    } else if (replace) createTab({ spaceId: tab.spaceId, active: true });
    else windowLayer.showView(null);
  }
  scheduleEmit();
}

export function closeTab(id: number): void {
  const tab = tabs.get(id);
  if (tab && isLoneStartPage({ id, spaceId: tab.spaceId, url: tab.errorUrl ?? tab.url }, [...tabs.values()])) return;
  closeTabInternal(id, true);
}

export function reopenClosedTab(): number | null {
  const entry = closedStack.pop();
  if (!entry) return null;
  return createTab({ url: entry.url, spaceId: getSpace(entry.spaceId) ? entry.spaceId : getActiveSpaceId(), active: true });
}

export function getActiveTab(): number | null {
  return activeTabId;
}

export function getTabSpaceId(id: number): SpaceId | null {
  return tabs.get(id)?.spaceId ?? null;
}

export function getTabWebContents(id: number): WebContents | null {
  return liveWc(tabs.get(id));
}

export function tabIdForWebContents(wcId: number): number | null {
  return wcToTab.get(wcId) ?? null;
}

export function noteBlocked(wcId: number): void {
  const id = wcToTab.get(wcId);
  const tab = id === undefined ? undefined : tabs.get(id);
  if (!tab) return;
  tab.blockedCount += 1;
  // Ad-heavy pages block dozens of requests per second; the badge doesn't need per-request pushes.
  if (blockedEmitTimer) return;
  blockedEmitTimer = setTimeout(() => {
    blockedEmitTimer = null;
    scheduleEmit();
  }, 150);
}

let blockedEmitTimer: NodeJS.Timeout | null = null;

export function navigateTab(id: number, input: string): void {
  const tab = tabs.get(id);
  if (!tab) return;
  const url = resolveInput(input, getSettings().searchEngine);
  if (!url) return;
  tab.errorUrl = null;
  tab.savedHistory = null;
  const existing = liveWc(tab);
  if (!existing) {
    tab.url = url;
    if (id === activeTabId) activateTab(id);
    else wake(tab);
    return;
  }
  loadInTab(tab, existing, url);
  if (id === activeTabId && !isInternalUrl(url)) existing.focus();
}

export function goBack(id: number): void {
  const wc = liveWc(tabs.get(id));
  if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
}

export function goForward(id: number): void {
  const wc = liveWc(tabs.get(id));
  if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
}

export function reloadTab(id: number, ignoreCache = false): void {
  const tab = tabs.get(id);
  if (!tab) return;
  const wc = liveWc(tab);
  if (!wc) {
    if (id === activeTabId) activateTab(id);
    else wake(tab);
    return;
  }
  if (tab.errorUrl) {
    loadInTab(tab, wc, tab.errorUrl);
    return;
  }
  if (ignoreCache) wc.reloadIgnoringCache();
  else wc.reload();
}

export function stopTab(id: number): void {
  liveWc(tabs.get(id))?.stop();
}

/**
 * Private memory the tab's renderer process gives back when the tab is destroyed: 0 when the
 * process is shared with another live tab (Chromium may host same-site tabs together).
 */
function exclusiveRendererKB(tab: Tab): number | null {
  const wc = liveWc(tab);
  if (!wc) return null;
  const own = framePids(wc);
  for (const other of tabs.values()) {
    const otherWc = other === tab ? null : liveWc(other);
    if (otherWc) for (const pid of framePids(otherWc)) own.delete(pid);
  }
  return rendererMemoryKB([...own]);
}

/** Every renderer process hosting a frame of `wc`: the page itself plus out-of-process iframes. */
function framePids(wc: WebContents): Set<number> {
  const pids = new Set<number>([wc.getOSProcessId()]);
  try {
    for (const frame of wc.mainFrame.framesInSubtree) pids.add(frame.osProcessId);
  } catch {
    /* frame tree unavailable while the renderer is going away */
  }
  return pids;
}

export function sleepTab(id: number): void {
  const tab = tabs.get(id);
  if (!tab || !tab.view || isOnScreen(id)) return;
  tab.freedKB = exclusiveRendererKB(tab);
  destroyView(tab, true);
  scheduleEmit();
}

export function togglePin(id: number): void {
  const tab = tabs.get(id);
  if (!tab) return;
  if (!tab.pinned && detachFromSplit(id)) showActive();
  tab.pinned = !tab.pinned;
  tab.groupId = null;
  order = order.filter((tid) => tid !== id);
  const firstUnpinned = order.findIndex((tid) => !tabs.get(tid)?.pinned);
  // Newly pinned → end of pinned block; unpinned → start of unpinned block. Same index either way.
  order.splice(firstUnpinned === -1 ? order.length : firstUnpinned, 0, id);
  scheduleEmit();
}

export function toggleMute(id: number): void {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.muted = !tab.muted;
  liveWc(tab)?.setAudioMuted(tab.muted);
  scheduleEmit();
}

/** Move a tab to `toIndex` within its space's tab list (pinned tabs stay first). */
export function moveTab(id: number, toIndex: number): void {
  const tab = tabs.get(id);
  if (!tab) return;
  const siblings = tabsInSpace(tab.spaceId).filter((t) => t !== tab);
  order = order.filter((tid) => tid !== id);
  const target = siblings[Math.max(0, Math.min(toIndex, siblings.length))];
  if (target) order.splice(order.indexOf(target.id), 0, id);
  else {
    const last = siblings[siblings.length - 1];
    order.splice(last ? order.indexOf(last.id) + 1 : order.length, 0, id);
  }
  normalizeOrder();
  scheduleEmit();
}

export function duplicateTab(id: number): number | null {
  const tab = tabs.get(id);
  if (!tab) return null;
  return createTab({ url: tab.errorUrl ?? tab.url, spaceId: tab.spaceId, active: true, title: tab.title, favicon: tab.favicon, afterId: id });
}

export function moveToSpace(id: number, spaceId: SpaceId): void {
  const tab = tabs.get(id);
  if (!tab || tab.spaceId === spaceId || !getSpace(spaceId)) return;
  const wasActive = id === activeTabId;
  const wasOnScreen = isOnScreen(id);
  const hadView = !!tab.view;
  if (activeBySpace.get(tab.spaceId) === id) activeBySpace.delete(tab.spaceId);
  detachFromSplit(id);
  destroyView(tab, false);
  if (wasOnScreen && !wasActive) showActive();
  tab.savedHistory = null;
  tab.blockedCount = 0;
  tab.spaceId = spaceId;
  tab.groupId = null;
  order = order.filter((tid) => tid !== id);
  order.push(id);
  normalizeOrder();
  if (wasActive) activateTab(id);
  else if (hadView) wake(tab);
  scheduleEmit();
}

export function findInTab(id: number, text: string, forward = true): void {
  const tab = tabs.get(id);
  const wc = liveWc(tab);
  if (!tab || !wc) return;
  if (!text) {
    stopFindInTab(id);
    return;
  }
  const findNext = text === tab.findText;
  tab.findText = text;
  wc.findInPage(text, { forward, findNext });
}

export function stopFindInTab(id: number): void {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.findText = '';
  liveWc(tab)?.stopFindInPage('clearSelection');
}

/** delta: +1 / -1 zoom step, 0 resets to 100%. */
export function zoomTab(id: number, delta: number): void {
  const tab = tabs.get(id);
  if (!tab) return;
  if (delta === 0) tab.zoom = 1;
  else {
    let index = ZOOM_STEPS.findIndex((step) => step >= tab.zoom - 0.001);
    if (index === -1) index = ZOOM_STEPS.length - 1;
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + Math.sign(delta)));
    tab.zoom = ZOOM_STEPS[next] ?? 1;
  }
  liveWc(tab)?.setZoomFactor(tab.zoom);
  scheduleEmit();
}

/** Activate the tab at `index` in the active space; negative index counts from the end. */
export function activateTabAt(index: number): void {
  const list = tabsInSpace(getActiveSpaceId());
  const tab = index < 0 ? list[list.length + index] : list[index];
  if (tab) activateTab(tab.id);
}

export function cycleTab(direction: 1 | -1): void {
  const list = tabsInSpace(getActiveSpaceId());
  if (list.length < 2) return;
  const index = list.findIndex((t) => t.id === activeTabId);
  const next = list[(index + direction + list.length) % list.length];
  if (next) activateTab(next.id);
}

export function activateSpace(spaceId: SpaceId): void {
  if (!getSpace(spaceId)) return;
  setActiveSpaceId(spaceId);
  const remembered = activeBySpace.get(spaceId);
  const rememberedTab = remembered === undefined ? undefined : tabs.get(remembered);
  if (rememberedTab && rememberedTab.spaceId === spaceId) {
    activateTab(rememberedTab.id);
    return;
  }
  const recent = tabsInSpace(spaceId).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  if (recent) activateTab(recent.id);
  else createTab({ spaceId, active: true });
}

/** Close all tabs of a space, then remove it (switching away first if it is active). */
export async function removeSpaceWithTabs(spaceId: SpaceId): Promise<void> {
  if (!getSpace(spaceId)) return;
  const others = listSpaces().filter((s) => s.id !== spaceId);
  const fallback = others[0];
  if (!fallback) throw new Error('Cannot remove the last space');
  if (getActiveSpaceId() === spaceId) activateSpace(fallback.id);
  for (const tab of tabsInSpace(spaceId)) closeTabInternal(tab.id, false);
  activeBySpace.delete(spaceId);
  for (let i = closedStack.length - 1; i >= 0; i--) {
    if (closedStack[i]?.spaceId === spaceId) closedStack.splice(i, 1);
  }
  await removeSpace(spaceId);
  scheduleEmit();
}

export function setContentBounds(bounds: ContentBounds): void {
  windowLayer.setContentBounds(bounds);
}

export function setOverlay(open: boolean): void {
  windowLayer.setOverlay(open);
}

function toState(tab: Tab): TabState {
  const wc = liveWc(tab);
  const history = wc?.navigationHistory;
  const saved = tab.savedHistory;
  return {
    id: tab.id,
    spaceId: tab.spaceId,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon,
    loading: tab.loading,
    canGoBack: history ? history.canGoBack() : !!saved && saved.index > 0,
    canGoForward: history ? history.canGoForward() : !!saved && saved.index < saved.entries.length - 1,
    asleep: !wc,
    audible: tab.audible,
    muted: tab.muted,
    pinned: tab.pinned,
    blockedCount: tab.blockedCount,
    zoom: tab.zoom,
    secure: isSecureUrl(tab.url),
    groupId: tab.groupId,
    splitId: splitIdOf(tab.id),
    devices: tabMediaDevices(tab.id),
    micActive: isMicActive(tab.id),
  };
}

/** All tabs of all spaces in display order; the UI filters by `activeSpaceId`. */
export function getBrowserState(): BrowserState {
  return {
    tabs: order.map((id) => toState(tabs.get(id)!)),
    activeTabId,
    spaces: listSpaces(),
    activeSpaceId: getActiveSpaceId(),
    groups: groupsInOrder(order, groupOf),
    splits: splitsInOrder(order),
  };
}

export function listSleepCandidates(): SleepCandidate[] {
  return order.map((id) => {
    const tab = tabs.get(id)!;
    return {
      id: tab.id,
      lastActiveAt: tab.lastActiveAt,
      audible: tab.audible,
      pinned: tab.pinned,
      asleep: !liveWc(tab),
      active: isOnScreen(tab.id),
    };
  });
}

/** Every tab in display order with its audible flag (audio mixer). */
export function listTabAudibility(): { id: number; audible: boolean }[] {
  return order.map((id) => ({ id, audible: tabs.get(id)!.audible }));
}

export function countTabs(): { awake: number; asleep: number; freedKB: number[] } {
  let awake = 0;
  const freedKB: number[] = [];
  for (const tab of tabs.values()) {
    if (liveWc(tab)) awake++;
    else if (tab.freedKB !== null) freedKB.push(tab.freedKB);
  }
  return { awake, asleep: tabs.size - awake, freedKB };
}

export function searchOpenTabs(query: string, limit: number): TabState[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: TabState[] = [];
  for (const id of order) {
    const tab = tabs.get(id)!;
    if (id === activeTabId) continue;
    if (tab.title.toLowerCase().includes(needle) || tab.url.toLowerCase().includes(needle)) results.push(toState(tab));
    if (results.length >= limit) break;
  }
  return results;
}

export function serializeSession(): SavedTab[] {
  return order
    .map((id) => tabs.get(id)!)
    .filter((tab) => !isEphemeral(tab.spaceId))
    .map((tab) => ({
      url: tab.errorUrl ?? tab.url,
      title: tab.title,
      favicon: tab.favicon,
      spaceId: tab.spaceId,
      pinned: tab.pinned,
      active: activeBySpace.get(tab.spaceId) === tab.id,
      ...(tab.groupId ? { group: savedGroup(tab.groupId) } : {}),
      ...(splitIdOf(tab.id) ? { split: savedSplit(tab.id) } : {}),
      ...(tabMediaDevices(tab.id) ? { devices: tabMediaDevices(tab.id)! } : {}),
      ...(tabAudioSettings(tab.id) ? { audio: tabAudioSettings(tab.id)! } : {}),
    }));
}

function isSavedTab(value: unknown): value is SavedTab {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<SavedTab>;
  return typeof t.url === 'string' && typeof t.spaceId === 'string' && t.url.length < 8192;
}

/**
 * Recreate saved tabs asleep, then activate the active space (waking only its active tab,
 * or opening a new tab when it has none). Returns the number of restored tabs.
 */
export function restoreSession(saved: unknown): number {
  const list = Array.isArray(saved) ? saved.filter(isSavedTab) : [];
  const base = Date.now() - list.length;
  let restored = 0;
  const splitEntries: { tabId: number; saved: unknown }[] = [];
  list.forEach((entry, i) => {
    if (!getSpace(entry.spaceId) || !/^(https?|vela|file):/i.test(entry.url)) return;
    const id = createTab({
      url: entry.url,
      spaceId: entry.spaceId,
      active: false,
      asleep: true,
      pinned: entry.pinned === true,
      title: typeof entry.title === 'string' ? entry.title : '',
      favicon: typeof entry.favicon === 'string' ? entry.favicon : null,
      groupId: entry.pinned === true ? null : restoreGroup(entry.spaceId, entry.group),
    });
    const tab = tabs.get(id)!;
    tab.lastActiveAt = base + i;
    if (entry.active) {
      tab.lastActiveAt = Date.now();
      activeBySpace.set(entry.spaceId, id);
    }
    if (entry.split) splitEntries.push({ tabId: id, saved: entry.split });
    restoreTabMediaDevices(id, entry.devices);
    restoreTabAudio(id, entry.audio);
    restored++;
  });
  restoreSplits(splitEntries);
  activateSpace(getActiveSpaceId());
  return restored;
}

bindGroupModel({
  order: () => order,
  tab: (id) => tabs.get(id),
  setGroupId: (id, groupId) => {
    // Split partners always share their group.
    for (const member of unitOf(id)) {
      const tab = tabs.get(member);
      if (!tab) continue;
      tab.groupId = groupId;
      if (groupId) tab.pinned = false;
    }
  },
  unitOf,
  commitOrder: (ids) => {
    order = ids.filter((id) => tabs.has(id));
    normalizeOrder();
    scheduleEmit();
  },
  activeTabId: () => activeTabId,
  activeSpaceId: getActiveSpaceId,
  activate: activateTab,
  close: closeTab,
  create: (opts) => createTab({ ...opts, active: true }),
  emit: scheduleEmit,
});

bindSplitModel({
  order: () => order,
  tab: (id) => tabs.get(id),
  activeTabId: () => activeTabId,
  adopt: (id, groupId) => {
    const tab = tabs.get(id);
    if (!tab) return;
    tab.pinned = false;
    tab.groupId = groupId && getGroup(groupId)?.spaceId === tab.spaceId ? groupId : null;
  },
  commitOrder: (ids) => {
    order = ids.filter((id) => tabs.has(id));
    normalizeOrder();
    scheduleEmit();
  },
  activate: activateTab,
  refresh: () => {
    showActive();
    scheduleEmit();
  },
  create: ({ spaceId, afterId }) => createTab({ spaceId, afterId, active: false }),
  emit: scheduleEmit,
});

onTabMediaChanged(scheduleEmit);

// Mixer sliders change settings many times a second: persist (via the state emit) at most twice a second.
let audioSaveTimer: NodeJS.Timeout | null = null;
onTabAudioChanged(() => {
  audioSaveTimer ??= setTimeout(() => {
    audioSaveTimer = null;
    scheduleEmit();
  }, 500);
});

onPaneFocus((id) => {
  if (id !== activeTabId && isOnScreen(id)) activateTab(id);
});
