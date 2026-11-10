import { app, ipcMain, webContents as allWebContents, type IpcMainEvent, type Session, type WebContents } from 'electron';
import { availableParallelism, totalmem } from 'node:os';
import { join } from 'node:path';
import { FINGERPRINT_CONFIG_CHANNEL, languageList, resolveTimezone, type FingerprintConfig } from '../../shared/fingerprint';
import type { Space, SpaceId } from '../../shared/types';
import { acceptLanguages, cleanUserAgent, registrableDomain } from '../privacy';
import { getSpace, listSpaces, onSessionCreated, onSessionRemoved, onSpacesChanged, routedCountryOf } from '../spaces';
import { setHeaderProfile } from './headers';
import { deriveWords, pruneSeeds, regenerateSeed, seedFor } from './seeds';
import { answerServiceWorkers, protectWorkersOf, type EmulationSettings, type WorkerGuard } from './workers';

const PRELOAD = join(__dirname, '..', 'preload', 'fingerprint.js');
const WORKER_PRELOAD = join(__dirname, '..', 'preload', 'fingerprint-worker.js');
const PRELOAD_ID = 'vela-fingerprint';

interface SessionEntry {
  spaceId: SpaceId;
  /** Registered frame preload id, or null while the space is 'off' (nothing is injected at all). */
  preload: string | null;
  /** Registered service-worker preload id, same lifetime. */
  workerPreload: string | null;
}

const entries = new Map<Session, SessionEntry>();
/** Tabs and popups whose dedicated/shared workers are being patched → stop function. */
const workerGuards = new Map<WebContents, WorkerGuard>();
/** WebContents types that host web pages of a Space (not DevTools, extension pages, offscreen). */
const PAGE_TYPES = new Set(['window', 'browserView', 'webview']);

/** Picks one of the `count` highest candidates not above the real value. */
function bucket(real: number, candidates: readonly number[], count: number, word: number): number {
  const fitting = candidates.filter((value) => value <= real).slice(-count);
  if (fitting.length === 0) return real;
  return fitting[word % fitting.length]!;
}

/** Chromium reports deviceMemory rounded to a power of two (installed RAM minus reserved ≈ 2^n). */
function realDeviceMemory(): number {
  const gib = totalmem() / 1024 ** 3;
  return Math.min(32, 2 ** Math.round(Math.log2(Math.max(gib, 0.25))));
}

interface HardwareProfile {
  cores: number;
  memory: number;
  gpu: number;
}

function hardwareFor(seed: string): HardwareProfile {
  const [coreWord = 0, memoryWord = 0, gpuWord = 0] = deriveWords(seed, 'hardware');
  return {
    cores: bucket(availableParallelism(), [2, 4, 6, 8, 12, 16], 3, coreWord),
    memory: bucket(realDeviceMemory(), [4, 8, 16], 2, memoryWord),
    gpu: gpuWord % 3,
  };
}

function isProtected(space: Space | undefined): space is Space {
  return !!space && space.fingerprint !== 'off';
}

/** Site used for the noise key: eTLD+1 of http(s) URLs; null for internal pages (never patched). */
function siteOf(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return 'opaque';
  }
  if (url.protocol === 'blob:') return siteOf(url.pathname);
  if (url.protocol === 'vela:' || url.protocol === 'devtools:' || url.protocol === 'chrome:') return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol;
  return registrableDomain(url.hostname);
}

/** The frame's top-level page URL, so third-party frames differ per site. */
function topUrlOf(event: IpcMainEvent, href: unknown): string {
  const frame = event.senderFrame;
  let topUrl = typeof href === 'string' ? href : '';
  try {
    if (frame && frame.parent) topUrl = frame.top?.url ?? topUrl;
  } catch {
    /* frame gone */
  }
  return topUrl;
}

/**
 * Patch config for a realm of `session` whose key site is `url`: the top-level page for frames and
 * dedicated workers, the worker's own URL / scope for shared and service workers.
 */
function configForUrl(session: Session, url: string): FingerprintConfig | null {
  const entry = entries.get(session);
  const space = entry ? getSpace(entry.spaceId) : undefined;
  if (!isProtected(space)) return null;
  const site = siteOf(url);
  if (site === null) return null;
  const seed = seedFor(space);
  return {
    strict: space.fingerprint === 'strict',
    key: deriveWords(seed, `site:${site}`),
    ...hardwareFor(seed),
    languages: space.language ? languageList(space.language) : null,
  };
}

/**
 * Without a proxy Chromium already hides local addresses behind mDNS, and the public address is the
 * one every HTTP request shows anyway, so 'standard' only pins WebRTC to the default route. With a
 * proxy (or in strict mode) UDP that bypasses the proxy would leak the real address: it is disabled.
 */
function webRtcPolicyFor(space: Space | undefined): Parameters<WebContents['setWebRTCIPHandlingPolicy']>[0] {
  if (!isProtected(space)) return 'default';
  const proxied = !!space.proxy && !/^direct:\/\//i.test(space.proxy);
  if (space.fingerprint === 'strict' || proxied) return 'disable_non_proxied_udp';
  return 'default_public_interface_only';
}

function applyWebRtc(wc: WebContents): void {
  const entry = entries.get(wc.session);
  if (!entry || wc.isDestroyed()) return;
  try {
    wc.setWebRTCIPHandlingPolicy(webRtcPolicyFor(getSpace(entry.spaceId)));
  } catch {
    /* destroyed meanwhile */
  }
}

/** Timezone and ICU locale for the pages of `session` (the system's unless the Space overrides them). */
function emulationFor(session: Session): EmulationSettings {
  const entry = entries.get(session);
  const space = entry ? getSpace(entry.spaceId) : undefined;
  if (!isProtected(space)) return { timezone: null, locale: null };
  let country: string | null = null;
  try {
    country = routedCountryOf(session);
  } catch {
    country = null;
  }
  return { timezone: resolveTimezone(space.timezone, space.fingerprint === 'strict', country), locale: space.language || null };
}

/** Accept-Language follows the Space language, so it matches navigator.languages. */
function applyAcceptLanguage(session: Session, language: string | null): void {
  const wanted = language ? languageList(language).join(',') : acceptLanguages();
  try {
    if (wanted) session.setUserAgent(cleanUserAgent(session.getUserAgent()), wanted);
  } catch {
    /* session gone */
  }
}

/** Starts or stops patching the workers of a page WebContents to match its Space's protection. */
function syncWorkerGuard(wc: WebContents): void {
  if (wc.isDestroyed()) return;
  const entry = entries.get(wc.session);
  const wanted = !!entry && isProtected(getSpace(entry.spaceId)) && PAGE_TYPES.has(wc.getType());
  const stop = workerGuards.get(wc);
  if (wanted === !!stop) return;
  if (stop) {
    workerGuards.delete(wc);
    stop.stop();
    refreshSiblings(wc.session);
    return;
  }
  const session = wc.session;
  const guard = protectWorkersOf(wc, configForUrl, () => emulationFor(session));
  if (!guard) return;
  workerGuards.set(wc, guard);
  wc.once('destroyed', () => {
    if (workerGuards.get(wc) !== guard) return;
    workerGuards.delete(wc);
    guard.stop();
    refreshSiblings(session);
  });
}

/** A renderer shared by several tabs loses its timezone override with the tab that set it: re-claim it. */
function refreshSiblings(session: Session): void {
  for (const [wc, guard] of workerGuards) if (wc.session === session) guard.refresh();
}

function unregister(session: Session, entry: SessionEntry): void {
  if (entry.preload) session.unregisterPreloadScript(entry.preload);
  if (entry.workerPreload) session.unregisterPreloadScript(entry.workerPreload);
  entry.preload = null;
  entry.workerPreload = null;
}

function sync(session: Session, entry: SessionEntry): void {
  const space = getSpace(entry.spaceId);
  if (isProtected(space)) {
    entry.preload ??= session.registerPreloadScript({ id: `${PRELOAD_ID}-${entry.spaceId}`, type: 'frame', filePath: PRELOAD });
    entry.workerPreload ??= session.registerPreloadScript({
      id: `${PRELOAD_ID}-worker-${entry.spaceId}`,
      type: 'service-worker',
      filePath: WORKER_PRELOAD,
    });
    setHeaderProfile(session, { strict: space.fingerprint === 'strict', memory: hardwareFor(seedFor(space)).memory });
    applyAcceptLanguage(session, space.language || null);
  } else {
    unregister(session, entry);
    setHeaderProfile(session, null);
    applyAcceptLanguage(session, null);
  }
}

function syncAll(): void {
  for (const [session, entry] of entries) sync(session, entry);
  for (const wc of allWebContents.getAllWebContents()) {
    applyWebRtc(wc);
    syncWorkerGuard(wc);
  }
  for (const guard of workerGuards.values()) guard.refresh();
  pruneSeeds(new Set(listSpaces().map((space) => space.id)));
}

export function initFingerprint(): void {
  ipcMain.on(FINGERPRINT_CONFIG_CHANNEL, (event, href: unknown) => {
    try {
      event.returnValue = configForUrl(event.sender.session, topUrlOf(event, href));
    } catch {
      event.returnValue = null;
    }
  });
  onSessionCreated((session, space) => {
    if (entries.has(session)) return;
    const entry: SessionEntry = { spaceId: space.id, preload: null, workerPreload: null };
    entries.set(session, entry);
    answerServiceWorkers(session, configForUrl);
    sync(session, entry);
  });
  onSessionRemoved((session) => {
    const entry = entries.get(session);
    if (entry) unregister(session, entry);
    entries.delete(session);
    setHeaderProfile(session, null);
  });
  onSpacesChanged(syncAll);
  app.on('web-contents-created', (_event, wc) => {
    applyWebRtc(wc);
    syncWorkerGuard(wc);
  });
}

/** New random seed: every site sees a new fingerprint after its next load. */
export function regenerateFingerprint(id: SpaceId): void {
  const space = getSpace(id);
  if (!space) throw new Error(`Unknown space: ${id}`);
  regenerateSeed(space);
  syncAll();
}
