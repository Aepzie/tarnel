import { session as electronSession, WebContentsView, type IpcMainInvokeEvent, type Rectangle, type Session } from 'electron';
import {
  badgeFromTitle,
  panelIdleAction,
  panelNextDeadline,
  PANELS_IPC,
  type PanelInfo,
  type PanelsState,
  type WebPanel,
} from '../../shared/panels';
import { userAgentPresets } from '../../shared/user-agent';
import { fetchFaviconData } from '../favicons';
import { enableAdblockForSession } from '../perf/adblock';
import { freezeWebContents, setLifecycleState } from '../perf/freeze';
import { attachSafety } from '../safety';
import { getSettings, updateSettings } from '../settings';
import { createTab } from '../tabs';
import { getMainWindow, restackWindow, sendToChrome, setSideViewsProvider } from '../window';
import { addPanel, getPanel, isPanelId, listPanels, partitionFor, patchFromInput, removePanel, updatePanel } from './store';

/**
 * Web panels (see shared/panels.ts). Nothing here runs until a panel is first opened: the rail
 * shows cached favicons, a panel's renderer is created on its first expand and kept alive while
 * collapsed (logged in, notifying) until the idle policy freezes it and later puts it to sleep
 * (renderer destroyed; the persistent partition keeps the login). One timer, armed only while a
 * collapsed panel has a pending idle stage.
 *
 * The open panel's WebContentsView is a "side view" of window.ts: stacked above the pages and
 * below a raised chrome. Its bounds come from the chrome's panel slot (`setBounds`), the page
 * viewport shrinks by the same flex layout.
 */

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

interface Runtime {
  view: WebContentsView;
  collapsedAt: number | null;
  frozen: boolean;
  badge: number;
  audible: boolean;
}

/** Re-check an audible panel, or one whose freeze was refused (realtime media), a minute later. */
const RECHECK_MS = 60_000;
/** Panels only get the permissions a chat/music/calendar app needs without prompting. */
const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen']);

const runtimes = new Map<string, Runtime>();
const preparedSessions = new WeakSet<Session>();
let openId: string | null = null;
let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
let idleTimer: NodeJS.Timeout | null = null;
let providerSet = false;

function mobileUserAgent(): string {
  const major = Number((process.versions.chrome ?? '').split('.')[0]);
  return userAgentPresets(major).find((preset) => preset.label === 'Chrome · Android')?.value ?? '';
}

function stateSnapshot(): PanelsState {
  const panels: PanelInfo[] = listPanels().map((panel) => {
    const runtime = runtimes.get(panel.id);
    return {
      ...panel,
      loaded: !!runtime,
      frozen: runtime?.frozen ?? false,
      audible: runtime?.audible ?? false,
      badge: runtime?.badge ?? 0,
    };
  });
  return { panels, openId };
}

function publish(): void {
  sendToChrome(PANELS_IPC.state, stateSnapshot());
}

function openView(): WebContentsView[] {
  const runtime = openId ? runtimes.get(openId) : undefined;
  return runtime ? [runtime.view] : [];
}

function ensureProvider(): void {
  if (providerSet) return;
  providerSet = true;
  setSideViewsProvider(openView);
}

function prepareSession(panel: WebPanel): Session {
  const ses = electronSession.fromPartition(partitionFor(panel.id));
  if (preparedSessions.has(ses)) return ses;
  preparedSessions.add(ses);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  enableAdblockForSession(ses);
  attachSafety(ses);
  return ses;
}

function applyUserAgent(panel: WebPanel, runtime: Runtime): void {
  const agent = panel.mobile ? mobileUserAgent() : '';
  const wc = runtime.view.webContents;
  if (agent) wc.setUserAgent(agent);
  else wc.setUserAgent(electronSession.defaultSession.getUserAgent());
}

function rememberFaviconFrom(panel: WebPanel, url: string, ses: Session): void {
  if (!/^https?:\/\//i.test(url)) return;
  fetchFaviconData(url, ses)
    .then((data) => {
      if (!data || !getPanel(panel.id) || getPanel(panel.id)?.favicon === data) return;
      updatePanel(panel.id, { favicon: data });
      publish();
    })
    .catch(() => undefined);
}

function isEditableFocused(runtime: Runtime): Promise<boolean> {
  return runtime.view.webContents
    .executeJavaScript(
      `(() => { const el = document.activeElement; return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); })()`,
      false,
    )
    .then((value: unknown) => value === true)
    .catch(() => true);
}

function createRuntime(panel: WebPanel): Runtime {
  const ses = prepareSession(panel);
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
      spellcheck: true,
    },
  });
  view.setBackgroundColor('#ffffff');
  const runtime: Runtime = { view, collapsedAt: null, frozen: false, badge: 0, audible: false };
  const wc = view.webContents;
  wc.setAudioMuted(panel.muted);
  applyUserAgent(panel, runtime);
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) createTab({ url, active: true });
    return { action: 'deny' };
  });
  wc.on('page-title-updated', (_event, title) => {
    const badge = badgeFromTitle(title);
    if (badge === runtime.badge) return;
    runtime.badge = badge;
    publish();
  });
  wc.on('page-favicon-updated', (_event, favicons) => {
    const first = favicons[0];
    if (first) rememberFaviconFrom(panel, first, ses);
  });
  wc.on('audio-state-changed', ({ audible }) => {
    runtime.audible = audible;
    publish();
    if (!audible) scheduleIdle();
  });
  wc.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape' || input.alt || input.control || input.meta || input.shift) return;
    if (openId !== panel.id) return;
    void isEditableFocused(runtime).then((editable) => {
      if (!editable && openId === panel.id) collapse();
    });
  });
  wc.on('render-process-gone', () => {
    if (openId !== panel.id) destroyRuntime(panel.id);
  });
  void wc.loadURL(panel.url).catch(() => undefined);
  runtimes.set(panel.id, runtime);
  return runtime;
}

function destroyRuntime(id: string): void {
  const runtime = runtimes.get(id);
  if (!runtime) return;
  runtimes.delete(id);
  getMainWindow()?.contentView.removeChildView(runtime.view);
  if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.close();
  if (openId === id) openId = null;
  publish();
}

function detachOpen(): void {
  const runtime = openId ? runtimes.get(openId) : undefined;
  if (runtime) {
    getMainWindow()?.contentView.removeChildView(runtime.view);
    runtime.collapsedAt = Date.now();
  }
  openId = null;
}

function collapse(): void {
  if (!openId) return;
  detachOpen();
  restackWindow();
  publish();
  scheduleIdle();
}

function expand(id: string): void {
  const panel = getPanel(id);
  if (!panel) return;
  ensureProvider();
  detachOpen();
  const runtime = runtimes.get(id) ?? createRuntime(panel);
  runtime.collapsedAt = null;
  if (runtime.frozen) {
    runtime.frozen = false;
    void setLifecycleState(runtime.view.webContents, 'active');
  }
  openId = id;
  runtime.view.setBounds(bounds);
  restackWindow();
  if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.focus();
  if (!getSettings().showPanelRail) updateSettings({ showPanelRail: true });
  publish();
  scheduleIdle();
}

function toggle(id: string): void {
  if (openId === id) collapse();
  else expand(id);
}

function idleLimits(): { freezeMs: number; sleepMs: number } {
  const { freezeAfterMinutes, sleepAfterMinutes } = getSettings();
  return { freezeMs: Math.max(0, freezeAfterMinutes) * 60_000, sleepMs: Math.max(0, sleepAfterMinutes) * 60_000 };
}

function candidate(runtime: Runtime): { collapsedAt: number | null; loaded: boolean; frozen: boolean; audible: boolean } {
  const wc = runtime.view.webContents;
  const audible = !wc.isDestroyed() && wc.isCurrentlyAudible();
  return { collapsedAt: runtime.collapsedAt, loaded: !wc.isDestroyed(), frozen: runtime.frozen, audible };
}

async function runIdle(): Promise<void> {
  idleTimer = null;
  const now = Date.now();
  const { freezeMs, sleepMs } = idleLimits();
  for (const [id, runtime] of [...runtimes]) {
    const action = panelIdleAction(candidate(runtime), now, freezeMs, sleepMs);
    if (action === 'sleep') destroyRuntime(id);
    if (action !== 'freeze') continue;
    const frozen = await freezeWebContents(runtime.view.webContents).catch(() => false);
    if (frozen && runtime.collapsedAt !== null) {
      runtime.frozen = true;
      publish();
    }
  }
  scheduleIdle();
}

function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const now = Date.now();
  const { freezeMs, sleepMs } = idleLimits();
  let next: number | null = null;
  for (const runtime of runtimes.values()) {
    const state = candidate(runtime);
    const due = panelNextDeadline(state, now, freezeMs, sleepMs);
    if (due === null) continue;
    const wait = state.audible || due === 0 ? RECHECK_MS : due;
    next = next === null ? wait : Math.min(next, wait);
  }
  if (next === null) return;
  idleTimer = setTimeout(() => void runIdle(), Math.max(1000, next));
  idleTimer.unref();
}

function setBounds(raw: unknown): void {
  if (!raw || typeof raw !== 'object') throw new TypeError('Invalid bounds');
  const rect = raw as Record<string, unknown>;
  const num = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Invalid bounds');
    return Math.max(0, Math.round(value));
  };
  bounds = { x: num(rect.x), y: num(rect.y), width: num(rect.width), height: num(rect.height) };
  const runtime = openId ? runtimes.get(openId) : undefined;
  if (!runtime) return;
  runtime.view.setBounds(bounds);
  const withRadius = runtime.view as WebContentsView & { setBorderRadius?: (radius: number) => void };
  withRadius.setBorderRadius?.(12);
}

function panelId(raw: unknown): string {
  if (!isPanelId(raw)) throw new TypeError('Unknown panel');
  return raw;
}

function add(input: unknown): PanelsState {
  const panel = addPanel(input);
  if (!getSettings().showPanelRail) updateSettings({ showPanelRail: true });
  rememberFaviconFrom(panel, new URL('/favicon.ico', panel.url).href, prepareSession(panel));
  publish();
  return stateSnapshot();
}

function update(rawId: unknown, rawPatch: unknown): PanelsState {
  const id = panelId(rawId);
  const before = getPanel(id);
  const patch = patchFromInput(rawPatch);
  const panel = updatePanel(id, patch);
  const runtime = runtimes.get(id);
  if (panel && runtime && before) {
    if (patch.mobile !== undefined && patch.mobile !== before.mobile) {
      applyUserAgent(panel, runtime);
      runtime.view.webContents.reload();
    }
    if (patch.url && patch.url !== before.url) void runtime.view.webContents.loadURL(panel.url).catch(() => undefined);
  }
  if (panel && patch.url && patch.url !== before?.url) rememberFaviconFrom(panel, new URL('/favicon.ico', panel.url).href, prepareSession(panel));
  publish();
  return stateSnapshot();
}

function remove(rawId: unknown): PanelsState {
  const id = panelId(rawId);
  const panel = getPanel(id);
  if (openId === id) collapse();
  destroyRuntime(id);
  removePanel(id);
  if (panel) {
    const ses = electronSession.fromPartition(partitionFor(panel.id));
    void ses.clearStorageData().catch(() => undefined);
    void ses.clearCache().catch(() => undefined);
  }
  publish();
  return stateSnapshot();
}

function toggleMute(rawId: unknown): void {
  const id = panelId(rawId);
  const panel = getPanel(id);
  if (!panel) return;
  updatePanel(id, { muted: !panel.muted });
  const runtime = runtimes.get(id);
  if (runtime && !runtime.view.webContents.isDestroyed()) runtime.view.webContents.setAudioMuted(!panel.muted);
  publish();
}

function reload(rawId: unknown): void {
  const id = panelId(rawId);
  const runtime = runtimes.get(id);
  if (!runtime) {
    expand(id);
    return;
  }
  if (runtime.frozen) {
    runtime.frozen = false;
    void setLifecycleState(runtime.view.webContents, 'active');
  }
  runtime.view.webContents.reload();
}

function openAsTab(rawId: unknown): void {
  const id = panelId(rawId);
  const runtime = runtimes.get(id);
  const current = runtime && !runtime.view.webContents.isDestroyed() ? runtime.view.webContents.getURL() : '';
  const url = /^https?:\/\//i.test(current) ? current : getPanel(id)?.url;
  if (!url) return;
  if (openId === id) collapse();
  createTab({ url, active: true });
}

/** Panel handlers: chrome-only runtime controls, list/add/update/remove also for vela://settings. */
export function registerPanelsIpc(handleChrome: ChromeHandler, handlePages: PagesHandler): void {
  handleChrome(PANELS_IPC.list, () => stateSnapshot());
  handleChrome(PANELS_IPC.add, (input) => add(input));
  handleChrome(PANELS_IPC.update, (id, patch) => update(id, patch));
  handleChrome(PANELS_IPC.remove, (id) => remove(id));
  handleChrome(PANELS_IPC.toggle, (id) => toggle(panelId(id)));
  handleChrome(PANELS_IPC.collapse, () => collapse());
  handleChrome(PANELS_IPC.setBounds, (rect) => setBounds(rect));
  handleChrome(PANELS_IPC.reload, (id) => reload(id));
  handleChrome(PANELS_IPC.toggleMute, (id) => toggleMute(id));
  handleChrome(PANELS_IPC.openAsTab, (id) => openAsTab(id));
  const settingsOnly = (event: IpcMainInvokeEvent): void => {
    if (!event.senderFrame?.url.startsWith('vela://settings')) throw new Error('Forbidden');
  };
  handlePages(PANELS_IPC.pageList, (event) => (settingsOnly(event), stateSnapshot()));
  handlePages(PANELS_IPC.pageAdd, (event, input) => (settingsOnly(event), add(input)));
  handlePages(PANELS_IPC.pageUpdate, (event, id, patch) => (settingsOnly(event), update(id, patch)));
  handlePages(PANELS_IPC.pageRemove, (event, id) => (settingsOnly(event), remove(id)));
}
