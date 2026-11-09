import { ipcMain, type Session, type WebContents } from 'electron';
import { join } from 'node:path';
import { MEDIA_ROUTE_CHANNEL, type MediaRoute } from '../../shared/audio-devices';
import type { MediaDeviceSlot, SpaceId } from '../../shared/types';
import { routeMediaDevices } from '../../preload/audio-devices-main-world';
import { setMediaPermissionHooks } from '../privacy';
import { getSpace, getSpaceSession, onSessionRemoved } from '../spaces';
import { getTabSpaceId, getTabWebContents, onStateChanged, onTabWebContents, tabIdForWebContents } from '../tabs';
import { isMediaSlot, onTabMediaChanged, parseChoice, routedTabIds, setMicActive, setTabMediaDevice, tabMediaDevices } from './state';

const PRELOAD = join(__dirname, '..', 'preload', 'audio-devices.js');
const PRELOAD_ID = 'vela-audio-devices';

/** Spaces whose session carries the preload: exactly those with at least one routed tab. */
const registered = new Map<SpaceId, { session: Session; id: string }>();
const ROUTE_SOURCE = routeMediaDevices.toString();

function routeOf(tabId: number | null): MediaRoute | null {
  if (tabId === null) return null;
  return tabMediaDevices(tabId);
}

function syncPreloads(): void {
  const wanted = new Set<SpaceId>();
  for (const tabId of routedTabIds()) {
    const spaceId = getTabSpaceId(tabId);
    if (spaceId && getSpace(spaceId)) wanted.add(spaceId);
  }
  for (const [spaceId, entry] of registered) {
    if (wanted.has(spaceId)) continue;
    registered.delete(spaceId);
    try {
      entry.session.unregisterPreloadScript(entry.id);
    } catch {
      /* session gone */
    }
  }
  for (const spaceId of wanted) {
    if (registered.has(spaceId)) continue;
    const session = getSpaceSession(spaceId);
    const id = session.registerPreloadScript({ id: `${PRELOAD_ID}-${spaceId}`, type: 'frame', filePath: PRELOAD });
    registered.set(spaceId, { session, id });
  }
}

/** Documents that are already loaded never ran the preload: route (or un-route) every frame in place. */
function pushRoute(tabId: number): void {
  const wc = getTabWebContents(tabId);
  if (!wc) return;
  const script = `(${ROUTE_SOURCE})(${JSON.stringify(routeOf(tabId) ?? {})})`;
  let frames: Electron.WebFrameMain[];
  try {
    frames = wc.mainFrame.framesInSubtree;
  } catch {
    return;
  }
  for (const frame of frames) {
    try {
      frame.executeJavaScript(script).catch(() => undefined);
    } catch {
      /* frame detached */
    }
  }
}

function slotsFor(mediaType: string | undefined): MediaDeviceSlot[] {
  if (mediaType === 'audio') return ['output', 'input'];
  if (mediaType === 'video') return ['camera'];
  return ['output', 'input', 'camera'];
}

/**
 * Device ids and labels are only exposed to origins with a media grant, and setSinkId to a non-default
 * output needs the same check. A tab the user routed must see them in every frame (its own salted ids,
 * for the slots that are routed) — capture itself still goes through the permission prompt.
 */
function allowsDeviceAccess(wc: WebContents | null, mediaType: string | undefined): boolean {
  if (!wc || wc.isDestroyed()) return false;
  const route = routeOf(tabIdForWebContents(wc.id));
  return !!route && slotsFor(mediaType).some((slot) => route[slot]);
}

function onMediaGranted(wc: WebContents, mediaTypes: ('video' | 'audio')[]): void {
  if (wc.isDestroyed() || !mediaTypes.includes('audio')) return;
  const tabId = tabIdForWebContents(wc.id);
  if (tabId !== null) setMicActive(tabId, true);
}

function watchTab(wc: WebContents, tabId: number): void {
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) setMicActive(tabId, false);
  });
  wc.once('destroyed', () => setMicActive(tabId, false));
}

export function initAudioDevices(): void {
  ipcMain.on(MEDIA_ROUTE_CHANNEL, (event) => {
    try {
      event.returnValue = routeOf(tabIdForWebContents(event.sender.id));
    } catch {
      event.returnValue = null;
    }
  });
  setMediaPermissionHooks({ allowsDeviceAccess, granted: onMediaGranted });
  onTabWebContents(watchTab);
  onSessionRemoved((session) => {
    for (const [spaceId, entry] of registered) if (entry.session === session) registered.delete(spaceId);
  });
  // A routed tab may move to another Space (another session).
  onStateChanged(() => {
    if (registered.size > 0 || routedTabIds().length > 0) syncPreloads();
  });
}

/** IPC entry point (chrome only, validated). */
export function setTabMediaDeviceFromChrome(tabId: number, slot: unknown, choice: unknown): void {
  if (!isMediaSlot(slot)) throw new TypeError('Invalid slot');
  if (getTabSpaceId(tabId) === null) throw new Error('Unknown tab');
  const parsed = choice === null ? null : parseChoice(choice);
  if (choice !== null && !parsed) throw new TypeError('Invalid device');
  setTabMediaDevice(tabId, slot, parsed);
}

onTabMediaChanged((tabId, change) => {
  if (change !== 'devices') return;
  syncPreloads();
  pushRoute(tabId);
});
