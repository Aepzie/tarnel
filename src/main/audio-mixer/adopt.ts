import type { WebContents } from 'electron';
import { adoptTabAudio } from '../../preload/audio-mixer-main-world';

const ADOPT_SOURCE = adoptTabAudio.toString();
const GROUP = 'vela-mixer-adopt';

interface RemoteObject {
  objectId?: string;
  value?: unknown;
}

/**
 * Sound that was already playing when the engine was installed live is out of its reach: a page
 * AudioContext's existing connections to `destination` cannot be enumerated from the page, and a
 * detached `new Audio()` or media in a closed shadow root cannot be found. The DevTools protocol can:
 * `Runtime.queryObjects` lists every AudioNode and media element of the top document's main world, and
 * the engine moves the ones feeding a destination into its chain (see MixerEngineHandle.adopt).
 *
 * One-shot per document, only for an audible tab with settings whose engine processes nothing. It
 * walks the heap (a few ms to ~100 ms on a big page), uses only Runtime commands (no domain enabled,
 * nothing for the page to observe), and reuses the tab's protocol client when fingerprint protection
 * already holds it (otherwise attaches and detaches). Subframes are not covered. Resolves to the number
 * of nodes/elements taken over, or null when the protocol client is unavailable.
 */
export async function adoptUnreachableAudio(wc: WebContents): Promise<number | null> {
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
  const send = (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> =>
    client.sendCommand(method, params) as Promise<Record<string, unknown>>;
  const objectIdOf = (result: Record<string, unknown>, key: string): string | undefined => (result[key] as RemoteObject | undefined)?.objectId;
  try {
    const prototype = async (expression: string): Promise<string | undefined> =>
      objectIdOf(await send('Runtime.evaluate', { expression, objectGroup: GROUP, silent: true }), 'result');
    const [nodeProto, mediaProto] = await Promise.all([prototype('AudioNode.prototype'), prototype('HTMLMediaElement.prototype')]);
    if (!nodeProto || !mediaProto) return null;
    const query = async (prototypeObjectId: string): Promise<string | undefined> =>
      objectIdOf(await send('Runtime.queryObjects', { prototypeObjectId, objectGroup: GROUP }), 'objects');
    const nodes = await query(nodeProto);
    const media = await query(mediaProto);
    if (!nodes || !media) return null;
    const outcome = await send('Runtime.callFunctionOn', {
      objectId: nodes,
      functionDeclaration: ADOPT_SOURCE,
      arguments: [{ objectId: nodes }, { objectId: media }],
      returnByValue: true,
      silent: true,
    });
    const value = (outcome.result as RemoteObject | undefined)?.value;
    return typeof value === 'number' && value >= 0 ? value : null;
  } catch {
    return null;
  } finally {
    client.sendCommand('Runtime.releaseObjectGroup', { objectGroup: GROUP }).catch(() => undefined);
    if (ownAttach) {
      try {
        client.detach();
      } catch {
        /* already gone */
      }
    }
  }
}
