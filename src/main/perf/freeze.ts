import type { WebContents } from 'electron';

/**
 * Tab freezing: the intermediate stage between awake and asleep. A frozen tab keeps its renderer
 * (and so its scroll position, form state and JS heap) but Chromium's Page Lifecycle freeze stops
 * its task queues: no timers, no rAF, no network callbacks, no workers ticking. It costs memory, not
 * CPU. It thaws instantly on activation; after the longer sleep timeout it is destroyed as before.
 *
 * Freezing goes through the tab's DevTools protocol client (`Page.setWebLifecycleState`). When the
 * fingerprint worker guard already holds that client it is reused as is; otherwise it is attached
 * for the one command and detached right away (the lifecycle state outlives the session).
 */

export interface FreezeCandidate {
  id: number;
  lastActiveAt: number;
  audible: boolean;
  pinned: boolean;
  asleep: boolean;
  /** On screen: the active tab or any visible pane of its split. */
  active: boolean;
  frozen: boolean;
  /** A download started by this tab is still in progress. */
  downloading: boolean;
}

/** Pinned tabs are kept running: they are mail, chat and calendars that must keep notifying. */
export function isFreezeEligible(tab: FreezeCandidate): boolean {
  return !tab.active && !tab.asleep && !tab.frozen && !tab.audible && !tab.pinned && !tab.downloading;
}

/** Tabs to freeze now, oldest first. `freezeAfterMs` <= 0 disables freezing. */
export function pickFreezeTargets(tabs: readonly FreezeCandidate[], now: number, freezeAfterMs: number): number[] {
  if (!(freezeAfterMs > 0)) return [];
  return tabs
    .filter((tab) => isFreezeEligible(tab) && now - tab.lastActiveAt > freezeAfterMs)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    .map((tab) => tab.id);
}

type LifecycleState = 'frozen' | 'active';

const GROUP = 'vela-freeze-check';

/**
 * Pages doing realtime work must not be frozen even when silent: a live getUserMedia / screen
 * capture track (camera, mic, screen share) or an open RTCPeerConnection (calls, data channels).
 * `Runtime.queryObjects` finds them however the page holds them. Top document's main world only.
 */
const REALTIME_CHECK = `function (tracks, peers) {
  for (const track of tracks) if (track.readyState === 'live') return true;
  for (const peer of peers) if (peer.connectionState !== 'closed') return true;
  return false;
}`;

async function withClient<T>(wc: WebContents, run: (send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<T>): Promise<T | null> {
  if (wc.isDestroyed()) return null;
  const client = wc.debugger;
  const ownAttach = !client.isAttached();
  if (ownAttach) {
    try {
      client.attach('1.3');
    } catch {
      return null;
    }
  }
  const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
    client.sendCommand(method, params) as Promise<Record<string, unknown>>;
  try {
    return await run(send);
  } catch {
    return null;
  } finally {
    if (ownAttach) {
      try {
        if (!wc.isDestroyed()) client.detach();
      } catch {
        /* already gone */
      }
    }
  }
}

/** True when the page holds live capture tracks or open peer connections; null if unknown. */
export function hasRealtimeMedia(wc: WebContents): Promise<boolean | null> {
  return withClient(wc, async (send) => {
    try {
      const objectId = async (expression: string): Promise<string | undefined> =>
        ((await send('Runtime.evaluate', { expression, objectGroup: GROUP, silent: true })).result as { objectId?: string } | undefined)?.objectId;
      const query = async (proto: string | undefined): Promise<string | undefined> =>
        proto ? ((await send('Runtime.queryObjects', { prototypeObjectId: proto, objectGroup: GROUP })).objects as { objectId?: string } | undefined)?.objectId : undefined;
      const [trackProto, peerProto] = await Promise.all([
        objectId('typeof MediaStreamTrack === "function" ? MediaStreamTrack.prototype : undefined'),
        objectId('typeof RTCPeerConnection === "function" ? RTCPeerConnection.prototype : undefined'),
      ]);
      const tracks = await query(trackProto);
      const peers = await query(peerProto);
      if (!tracks && !peers) return false;
      const holder = tracks ?? peers!;
      const outcome = await send('Runtime.callFunctionOn', {
        objectId: holder,
        functionDeclaration: REALTIME_CHECK,
        arguments: [tracks ? { objectId: tracks } : { value: [] }, peers ? { objectId: peers } : { value: [] }],
        returnByValue: true,
        silent: true,
      });
      return (outcome.result as { value?: unknown } | undefined)?.value === true;
    } finally {
      send('Runtime.releaseObjectGroup', { objectGroup: GROUP }).catch(() => undefined);
    }
  });
}

/** Sets the page's lifecycle state; resolves true when Chromium accepted it. */
export async function setLifecycleState(wc: WebContents, state: LifecycleState): Promise<boolean> {
  const done = await withClient(wc, async (send) => {
    await send('Page.setWebLifecycleState', { state });
    return true;
  });
  return done === true;
}

/** Freezes `wc` unless it is audible or doing realtime media. Resolves true when frozen. */
export async function freezeWebContents(wc: WebContents): Promise<boolean> {
  if (wc.isDestroyed() || wc.isCurrentlyAudible() || wc.isDevToolsOpened()) return false;
  const realtime = await hasRealtimeMedia(wc);
  if (realtime !== false || wc.isDestroyed() || wc.isCurrentlyAudible()) return false;
  return setLifecycleState(wc, 'frozen');
}
