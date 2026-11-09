import { app, ipcMain, webContents as allWebContents, type IpcMainEvent, type Session, type WebContents } from 'electron';
import { availableParallelism, totalmem } from 'node:os';
import { join } from 'node:path';
import { FINGERPRINT_CONFIG_CHANNEL, type FingerprintConfig } from '../../shared/fingerprint';
import type { Space, SpaceId } from '../../shared/types';
import { registrableDomain } from '../privacy';
import { getSpace, listSpaces, onSessionCreated, onSessionRemoved, onSpacesChanged } from '../spaces';
import { setHeaderProfile } from './headers';
import { deriveWords, pruneSeeds, regenerateSeed, seedFor } from './seeds';

const PRELOAD = join(__dirname, '..', 'preload', 'fingerprint.js');
const PRELOAD_ID = 'vela-fingerprint';

interface SessionEntry {
  spaceId: SpaceId;
  /** Registered preload id, or null while the space is 'off' (nothing is injected at all). */
  preload: string | null;
}

const entries = new Map<Session, SessionEntry>();

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

/** Site used for the noise key: the top-level page's eTLD+1, so third-party frames differ per site. */
function topSite(event: IpcMainEvent, href: unknown): string | null {
  const frame = event.senderFrame;
  let topUrl = typeof href === 'string' ? href : '';
  try {
    if (frame && frame.parent) topUrl = frame.top?.url ?? topUrl;
  } catch {
    /* frame gone */
  }
  let url: URL;
  try {
    url = new URL(topUrl);
  } catch {
    return 'opaque';
  }
  if (url.protocol === 'vela:' || url.protocol === 'devtools:' || url.protocol === 'chrome:') return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol;
  return registrableDomain(url.hostname);
}

function configFor(event: IpcMainEvent, href: unknown): FingerprintConfig | null {
  const entry = entries.get(event.sender.session);
  const space = entry ? getSpace(entry.spaceId) : undefined;
  if (!isProtected(space)) return null;
  const site = topSite(event, href);
  if (site === null) return null;
  const seed = seedFor(space);
  return { strict: space.fingerprint === 'strict', key: deriveWords(seed, `site:${site}`), ...hardwareFor(seed) };
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

function sync(session: Session, entry: SessionEntry): void {
  const space = getSpace(entry.spaceId);
  if (isProtected(space)) {
    entry.preload ??= session.registerPreloadScript({ id: `${PRELOAD_ID}-${entry.spaceId}`, type: 'frame', filePath: PRELOAD });
    setHeaderProfile(session, { strict: space.fingerprint === 'strict', memory: hardwareFor(seedFor(space)).memory });
  } else {
    if (entry.preload) session.unregisterPreloadScript(entry.preload);
    entry.preload = null;
    setHeaderProfile(session, null);
  }
}

function syncAll(): void {
  for (const [session, entry] of entries) sync(session, entry);
  for (const wc of allWebContents.getAllWebContents()) applyWebRtc(wc);
  pruneSeeds(new Set(listSpaces().map((space) => space.id)));
}

export function initFingerprint(): void {
  ipcMain.on(FINGERPRINT_CONFIG_CHANNEL, (event, href: unknown) => {
    try {
      event.returnValue = configFor(event, href);
    } catch {
      event.returnValue = null;
    }
  });
  onSessionCreated((session, space) => {
    if (entries.has(session)) return;
    const entry: SessionEntry = { spaceId: space.id, preload: null };
    entries.set(session, entry);
    sync(session, entry);
  });
  onSessionRemoved((session) => {
    const entry = entries.get(session);
    if (entry?.preload) session.unregisterPreloadScript(entry.preload);
    entries.delete(session);
    setHeaderProfile(session, null);
  });
  onSpacesChanged(syncAll);
  app.on('web-contents-created', (_event, wc) => applyWebRtc(wc));
}

/** New random seed: every site sees a new fingerprint after its next load. */
export function regenerateFingerprint(id: SpaceId): void {
  const space = getSpace(id);
  if (!space) throw new Error(`Unknown space: ${id}`);
  regenerateSeed(space);
  syncAll();
}
