import { app, ipcMain, net } from 'electron';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ElectronBlocker, type Request } from '@ghostery/adblocker-electron';
import { getSettings, onSettingsChanged } from '../settings';
import { onSessionRemoved } from '../spaces';
import { createStore, type JsonStore } from '../store';

/**
 * Network-level content blocking (Ghostery engine: EasyList + EasyPrivacy + uBO-style lists).
 *
 * Startup path is designed to never wait on the network: the compiled engine is cached as a
 * serialized binary in userData and deserialized in a few ms. If the cache is stale (>24h) a fresh
 * engine is built in the background and hot-swapped into every session. Any failure leaves the
 * browser working, just unblocked.
 */

type BlockedListener = (webContentsId: number, url: string) => void;
interface StatsStore {
  blockedTotal: number;
}

const CACHE_FILE = 'adblock-engine.bin';
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
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
const sessions = new Set<Electron.Session>();
const listeners = new Set<BlockedListener>();

function cachePath(): string {
  return path.join(app.getPath('userData'), CACHE_FILE);
}

/** `net.fetch` honours the system / Chromium proxy configuration, unlike Node's global fetch. */
function fetchImpl(url: string): Promise<Response> {
  return net.fetch(url);
}

async function writeCache(engine: ElectronBlocker): Promise<void> {
  const file = cachePath();
  const tmp = `${file}.tmp`;
  await writeFile(tmp, engine.serialize());
  await rename(tmp, file); // atomic: a crash mid-write never leaves a truncated engine behind
}

async function loadFromCache(): Promise<{ engine: ElectronBlocker; ageMs: number } | null> {
  try {
    const file = cachePath();
    const [info, bytes] = await Promise.all([stat(file), readFile(file)]);
    // Throws on corrupt data or on a serialization-format bump after a library upgrade.
    const engine = ElectronBlocker.deserialize(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { engine, ageMs: Date.now() - info.mtimeMs };
  } catch {
    return null;
  }
}

async function loadFromNetwork(): Promise<ElectronBlocker> {
  const engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchImpl);
  await writeCache(engine).catch(() => undefined); // caching is an optimisation, not a requirement
  return engine;
}

function recordBlocked(request: Request): void {
  blockedTotal += 1;
  stats?.update((current) => ({ blockedTotal: current.blockedTotal + 1 }));
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
}

function enableIn(engine: ElectronBlocker, session: Electron.Session): void {
  try {
    if (engine.isBlockingEnabled(session)) return;
    for (const channel of IPC_CHANNELS) ipcMain.removeHandler(channel);
    engine.enableBlockingInSession(session);
  } catch (err) {
    console.error('[adblock] enable failed', err);
  }
}

function disableIn(engine: ElectronBlocker, session: Electron.Session): void {
  try {
    if (engine.isBlockingEnabled(session)) engine.disableBlockingInSession(session);
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
  try {
    install(await loadFromNetwork());
  } catch (err) {
    console.warn('[adblock] background refresh failed; keeping cached engine', err);
  }
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

  try {
    const cached = await loadFromCache();
    if (cached) {
      install(cached.engine);
      if (cached.ageMs > REFRESH_AFTER_MS) void refreshInBackground();
      return;
    }
    install(await loadFromNetwork());
  } catch (err) {
    // Offline first run or CDN outage: browse unblocked rather than fail.
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
