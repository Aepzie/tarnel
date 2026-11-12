import { ipcMain, type IpcMainEvent, type Session } from 'electron';
import path from 'node:path';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { ADBLOCK_EARLY_CHANNEL, EarlyFrames, LruCache, scriptletPageUrl } from '../../shared/adblock-early';
import { getEngine } from './adblock';
import { isolateScriptlet } from './adblock-scriptlets';
import { registrableDomain } from '../net/domain';
import { getSettings, onSettingsChanged } from '../settings';
import { onSessionCreated, onSessionRemoved } from '../spaces';

/**
 * Document-start scriptlets (uBO-style `+js()` rules: json-prune, set-constant, ...).
 *
 * The library delivers scriptlets from its preload via an async IPC round trip and then
 * `webContents.executeJavaScript` — by then a page's inline scripts already ran. YouTube reads
 * `ytInitialPlayerResponse` (with `playerAds` / `adPlacements`) in its first inline scripts, so
 * the ad fields survived and ads played.
 *
 * Here a session preload (src/preload/adblock-early.ts, registered only while ad blocking is on)
 * asks main synchronously for the frame's scriptlets and runs them in the page's main world before
 * any page script, in every frame (YouTube embeds included; the library only serves top frames).
 * Each scriptlet keeps its own scope (adblock-scriptlets.ts). The library's late path still injects
 * CSS, but for a document already served here it gets no scripts: a second json-prune / fetch proxy
 * on top of the first is what once broke the YouTube player.
 */

const PRELOAD = path.join(__dirname, '..', 'preload', 'adblock-early.js');
const PRELOAD_ID = 'vela-adblock-early';
const CACHE_SIZE = 64;

type CosmeticsQuery = Parameters<ElectronBlocker['getCosmeticsFilters']>[0];
type CosmeticsResult = ReturnType<ElectronBlocker['getCosmeticsFilters']>;

const sessions = new Set<Session>();
const earlyFrames = new EarlyFrames();
const caches = new WeakMap<ElectronBlocker, LruCache<string[]>>();
const NONE: string[] = [];
let active = false;

function syncPreload(session: Session, on: boolean): void {
  try {
    const registered = session.getPreloadScripts().some((script) => script.id === PRELOAD_ID);
    if (on && !registered) session.registerPreloadScript({ id: PRELOAD_ID, type: 'frame', filePath: PRELOAD });
    if (!on && registered) session.unregisterPreloadScript(PRELOAD_ID);
  } catch {
    /* session gone */
  }
}

function scriptletsFor(engine: ElectronBlocker, url: string): string[] {
  let cache = caches.get(engine);
  if (!cache) {
    cache = new LruCache<string[]>(CACHE_SIZE);
    caches.set(engine, cache);
  }
  const cached = cache.get(url);
  if (cached) return cached;
  const hostname = new URL(url).hostname;
  const result = engine.getCosmeticsFilters({
    url,
    hostname,
    domain: registrableDomain(hostname),
    getBaseRules: false,
    getInjectionRules: true,
    getExtendedRules: false,
    getRulesFromHostname: true,
    getRulesFromDOM: false,
  });
  const scripts = result.active ? result.scripts.map(isolateScriptlet) : NONE;
  cache.set(url, scripts);
  return scripts;
}

function frameScriptlets(event: IpcMainEvent, href: unknown): string[] {
  if (!active || !sessions.has(event.sender.session)) return NONE;
  const url = scriptletPageUrl(href);
  const engine = getEngine();
  if (!url || !engine || !event.senderFrame) return NONE;
  return scriptletsFor(engine, url);
}

/**
 * The library's late path reads scriptlets through `getCosmeticsFilters` with the IPC event's frame
 * as `callerContext`. For a document that already got them at document start, ask for CSS only.
 */
function dedupeLatePath(): void {
  const proto = ElectronBlocker.prototype as unknown as { getCosmeticsFilters: (query: CosmeticsQuery) => CosmeticsResult };
  const original = proto.getCosmeticsFilters;
  proto.getCosmeticsFilters = function getCosmeticsFilters(this: ElectronBlocker, query: CosmeticsQuery): CosmeticsResult {
    const caller = query.callerContext as { processId?: unknown; frameId?: unknown } | undefined;
    const servedEarly =
      query.getInjectionRules === true &&
      typeof caller?.processId === 'number' &&
      typeof caller.frameId === 'number' &&
      earlyFrames.consume(caller.processId, caller.frameId);
    return original.call(this, servedEarly ? { ...query, getInjectionRules: false } : query);
  };
}

export function initAdblockEarly(): void {
  dedupeLatePath();
  ipcMain.on(ADBLOCK_EARLY_CHANNEL, (event, href: unknown) => {
    let scripts = NONE;
    try {
      scripts = frameScriptlets(event, href);
    } catch {
      scripts = NONE;
    }
    earlyFrames.record(event.processId, event.frameId, scripts.length > 0);
    event.returnValue = scripts;
  });
  active = getSettings().adblock;
  onSessionCreated((session) => {
    sessions.add(session);
    syncPreload(session, active);
  });
  onSessionRemoved((session) => sessions.delete(session));
  onSettingsChanged((settings) => {
    if (settings.adblock === active) return;
    active = settings.adblock;
    for (const session of sessions) syncPreload(session, active);
  });
}
