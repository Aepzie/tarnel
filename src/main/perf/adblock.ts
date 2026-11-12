import { app, ipcMain, net } from 'electron';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ENGINE_VERSION, ElectronBlocker, type Request } from '@ghostery/adblocker-electron';
import { cacheKey, decodeCache, encodeCache } from './adblock-cache';
import { adblockRefreshAfterMs } from './battery-policy';
import { isBatterySaverActive } from './battery-saver';
import { isolateScriptlet } from './adblock-scriptlets';
import { addWebRequestStage, removeWebRequestStage, STAGE_ORDER } from '../net/dispatcher';
import { getSettings, onSettingsChanged } from '../settings';
import { gateSessionReady, onSessionCreated, onSessionRemoved } from '../spaces';
import { createStore, type JsonStore } from '../store';
import { countBlockedRequest } from '../privacy-report/collector';

/**
 * Network-level content blocking (Ghostery engine: EasyList + EasyPrivacy + uBO-style lists).
 *
 * Startup path is designed to never wait on the network: the compiled engine is cached as a
 * serialized binary in userData (keyed by Ghostery version + list set, see adblock-cache.ts) and
 * deserialized in a few ms. Whenever the engine is older than 24h (72h while battery saver is on;
 * checked at start and hourly) a
 * fresh one is built in the background and hot-swapped into every session in one synchronous step,
 * so no request sees a half-swapped state. New sessions gate whenSessionReady() on the first engine,
 * so the first page request is already filtered; on a cold first run without cache that gate is
 * capped (READY_GATE_MAX_MS). Any failure leaves the browser working, just unblocked.
 */

type BlockedListener = (webContentsId: number, url: string) => void;
interface StatsStore {
  blockedTotal: number;
}

const CACHE_FILE = 'adblock-engine.bin';
const LIST_SET = 'prebuilt-ads-tracking';
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const REFRESH_CHECK_MS = 60 * 60 * 1000;
// Cold first run (no cache): how long new sessions wait for the network-built engine before pages
// load unblocked. A warm start resolves in a few ms, far below this.
const READY_GATE_MAX_MS = 3_000;
// Retry schedule while no engine could be loaded (offline first run): 30s, 60s, 2m, ... capped at 30m.
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;
// The library registers these ipcMain.handle channels once per enabled session, but ipcMain only
// allows one handler per channel; we clear them before each enable so multiple Spaces can coexist.
// The handlers only delegate to the (shared) engine, so whichever registration wins is equivalent.
const IPC_CHANNELS = [
  '@ghostery/adblocker/inject-cosmetic-filters',
  '@ghostery/adblocker/is-mutation-observer-enabled',
] as const;

let blocker: ElectronBlocker | null = null;
let enabled = true;
let initStarted = false;
let stats: JsonStore<StatsStore> | null = null;
let blockedTotal = 0;
let engineBuiltAt = 0;
let refreshing = false;
let markReady: () => void = () => undefined;
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});
let readyGate: Promise<void> | null = null;
const sessions = new Set<Electron.Session>();
const listeners = new Set<BlockedListener>();

function cachePath(): string {
  return path.join(app.getPath('userData'), CACHE_FILE);
}

function libraryVersion(): string {
  try {
    return (require('@ghostery/adblocker-electron/package.json') as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

const CACHE_KEY = cacheKey({ engineVersion: ENGINE_VERSION, libraryVersion: libraryVersion(), lists: LIST_SET });

/** `net.fetch` honours the system / Chromium proxy configuration, unlike Node's global fetch. */
function fetchImpl(url: string): Promise<Response> {
  return net.fetch(url);
}

async function writeCache(engine: ElectronBlocker): Promise<void> {
  const file = cachePath();
  const tmp = `${file}.tmp`;
  await writeFile(tmp, encodeCache(CACHE_KEY, engine.serialize()));
  await rename(tmp, file); // atomic: a crash mid-write never leaves a truncated engine behind
}

async function loadFromCache(): Promise<{ engine: ElectronBlocker; builtAt: number } | null> {
  const file = cachePath();
  let bytes: Buffer;
  let builtAt: number;
  try {
    [{ mtimeMs: builtAt }, bytes] = await Promise.all([stat(file), readFile(file)]);
  } catch {
    return null; // no cache yet
  }
  try {
    const body = decodeCache(CACHE_KEY, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    if (!body) throw new Error('cache was built by another library version or list set');
    // Throws on corrupt data; Ghostery also checks its own ENGINE_VERSION.
    return { engine: ElectronBlocker.deserialize(body), builtAt };
  } catch (err) {
    console.warn('[adblock] discarding unusable engine cache; rebuilding', err);
    await unlink(file).catch(() => undefined);
    return null;
  }
}

async function loadFromNetwork(): Promise<ElectronBlocker> {
  const engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchImpl);
  engineBuiltAt = Date.now();
  await writeCache(engine).catch(() => undefined); // caching is an optimisation, not a requirement
  return engine;
}

function recordBlocked(request: Request): void {
  blockedTotal += 1;
  stats?.update((current) => ({ blockedTotal: current.blockedTotal + 1 }));
  countBlockedRequest(request.tabId, request.url, request.type);
  // tabId is the Electron webContentsId; it is 0/undefined for service-worker and browser requests.
  if (request.tabId > 0) {
    for (const cb of listeners) {
      try {
        cb(request.tabId, request.url);
      } catch {
        /* a faulty listener must not break blocking */
      }
    }
  }
}

function attachEvents(engine: ElectronBlocker): void {
  engine.on('request-blocked', recordBlocked);
  // Redirects replace the resource with a neutered stub (e.g. empty analytics.js): a block in effect.
  engine.on('request-redirected', recordBlocked);
  isolateScriptlets(engine);
}

/**
 * The library's IPC handler calls `engine.onInjectCosmeticFilters` at call time, which only touches
 * `event.sender.insertCSS` / `executeJavaScript`: hand it a sender that runs every scriptlet in its
 * own scope (adblock-scriptlets.ts).
 */
function isolateScriptlets(engine: ElectronBlocker): void {
  const inject = engine.onInjectCosmeticFilters;
  engine.onInjectCosmeticFilters = (event, url, msg) => {
    const page = event.sender;
    const sender = {
      insertCSS: (css: string, options?: Electron.InsertCSSOptions) => page.insertCSS(css, options),
      executeJavaScript: (code: string, userGesture?: boolean) =>
        page.executeJavaScript(isolateScriptlet(code), userGesture).catch(() => undefined),
    } as unknown as Electron.WebContents;
    return inject(Object.create(event, { sender: { value: sender } }) as Electron.IpcMainInvokeEvent, url, msg);
  };
}

type BeforeRequestListener = (details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void) => void;
type HeadersReceivedListener = (details: Electron.OnHeadersReceivedListenerDetails, callback: (response: Electron.HeadersReceivedResponse) => void) => void;

/**
 * What the library's BlockingContext touches on a session, routed through the shared webRequest
 * dispatcher (net/dispatcher.ts): Electron allows one listener per webRequest event, and the
 * dispatcher also runs extension declarativeNetRequest and the privacy header stage. The library
 * keeps doing everything else exactly as before (preload, IPC, CSP injection, redirects).
 */
interface BlockerSession {
  registerPreloadScript: Electron.Session['registerPreloadScript'];
  unregisterPreloadScript: Electron.Session['unregisterPreloadScript'];
  webRequest: {
    onBeforeRequest(filter: Electron.WebRequestFilter | null, listener?: BeforeRequestListener | null): void;
    onHeadersReceived(filter: Electron.WebRequestFilter | null, listener?: HeadersReceivedListener | null): void;
  };
}

const facades = new WeakMap<Electron.Session, BlockerSession>();

/** The library's listeners answer synchronously; turn the callback into a return value. */
function callSync<D, R>(listener: (details: D, callback: (response: R) => void) => void, details: D): R | undefined {
  let response: R | undefined;
  listener(details, (value) => {
    response = value;
  });
  return response;
}

function facadeOf(session: Electron.Session): Electron.Session {
  let facade = facades.get(session);
  if (!facade) {
    facade = {
      registerPreloadScript: (script) => session.registerPreloadScript(script),
      unregisterPreloadScript: (id) => session.unregisterPreloadScript(id),
      webRequest: {
        onBeforeRequest(_filter, listener) {
          if (!listener) return removeWebRequestStage(session, 'beforeRequest', 'adblock');
          addWebRequestStage(session, 'beforeRequest', 'adblock', STAGE_ORDER.adblock, (details) => callSync(listener, details));
        },
        onHeadersReceived(_filter, listener) {
          if (!listener) return removeWebRequestStage(session, 'headersReceived', 'adblock');
          addWebRequestStage(session, 'headersReceived', 'adblock', STAGE_ORDER.adblock, (details) => callSync(listener, details));
        },
      },
    };
    facades.set(session, facade);
  }
  return facade as unknown as Electron.Session;
}

function enableIn(engine: ElectronBlocker, session: Electron.Session): void {
  try {
    const facade = facadeOf(session);
    if (engine.isBlockingEnabled(facade)) return;
    for (const channel of IPC_CHANNELS) ipcMain.removeHandler(channel);
    engine.enableBlockingInSession(facade);
  } catch (err) {
    console.error('[adblock] enable failed', err);
  }
}

function disableIn(engine: ElectronBlocker, session: Electron.Session): void {
  try {
    const facade = facadeOf(session);
    if (engine.isBlockingEnabled(facade)) engine.disableBlockingInSession(facade);
  } catch (err) {
    console.error('[adblock] disable failed', err);
  }
}

function applyAll(): void {
  const engine = blocker;
  if (!engine) return;
  // Disable first, then enable: disabling any session removes the shared IPC handlers.
  if (!enabled) {
    for (const session of sessions) disableIn(engine, session);
    return;
  }
  for (const session of sessions) enableIn(engine, session);
}

function install(engine: ElectronBlocker): void {
  const previous = blocker;
  if (previous) for (const session of sessions) disableIn(previous, session);
  attachEvents(engine);
  blocker = engine;
  applyAll();
  markReady();
}

function scheduleRetry(delayMs: number): void {
  const timer = setTimeout(() => {
    if (blocker) return;
    loadFromNetwork()
      .then(install) // install() applies every session queued while we were offline
      .catch(() => scheduleRetry(Math.min(delayMs * 2, RETRY_MAX_MS)));
  }, delayMs);
  timer.unref();
}

async function refreshInBackground(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    install(await loadFromNetwork());
  } catch (err) {
    console.warn('[adblock] background refresh failed; keeping cached engine', err);
  } finally {
    refreshing = false;
  }
}

function refreshIfStale(): void {
  if (blocker && Date.now() - engineBuiltAt > adblockRefreshAfterMs(REFRESH_AFTER_MS, isBatterySaverActive())) void refreshInBackground();
}

export async function initAdblock(): Promise<void> {
  if (initStarted) return;
  initStarted = true;

  try {
    stats = createStore<StatsStore>('stats', { blockedTotal: 0 });
    blockedTotal = stats.get().blockedTotal;
  } catch {
    stats = null;
  }

  try {
    enabled = getSettings().adblock;
    onSettingsChanged((settings) => setAdblockEnabled(settings.adblock));
  } catch {
    /* settings unavailable: default to enabled */
  }

  // Removed/burner Spaces must not stay referenced (leak) or be toggled later.
  onSessionRemoved((session: Electron.Session) => {
    if (!sessions.delete(session)) return;
    if (blocker) disableIn(blocker, session);
  });

  // First page loads of every new session wait for the engine (capped for the cold, uncached case).
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, READY_GATE_MAX_MS).unref());
  readyGate = Promise.race([ready, timeout]);
  onSessionCreated((_session, space) => {
    if (enabled && !blocker && readyGate) gateSessionReady(space.id, readyGate);
  });

  setInterval(refreshIfStale, REFRESH_CHECK_MS).unref();

  const startedAt = performance.now();
  try {
    const cached = await loadFromCache();
    if (cached) {
      engineBuiltAt = cached.builtAt;
      install(cached.engine);
      console.info(`[adblock] engine ready from cache in ${Math.round(performance.now() - startedAt)} ms`);
      refreshIfStale();
      return;
    }
    install(await loadFromNetwork());
    console.info(`[adblock] engine ready from network in ${Math.round(performance.now() - startedAt)} ms`);
  } catch (err) {
    // Offline first run or CDN outage: browse unblocked rather than fail.
    markReady();
    console.warn('[adblock] engine unavailable, continuing without blocking; will retry', err);
    scheduleRetry(RETRY_BASE_MS);
  }
}

export function enableAdblockForSession(session: Electron.Session): void {
  if (sessions.has(session)) return;
  sessions.add(session);
  if (blocker && enabled) enableIn(blocker, session);
}

export function setAdblockEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  applyAll();
}

export function onBlocked(cb: BlockedListener): void {
  listeners.add(cb);
}

export function getBlockedTotal(): number {
  return blockedTotal;
}

export function getEngine(): ElectronBlocker | null {
  return blocker;
}
