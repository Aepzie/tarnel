import { ipcMain } from 'electron';
import { join } from 'node:path';
import { IDENTITY_HINTS_CHANNEL } from '../../shared/identity';
import { onSessionCreated } from '../spaces';
import { rememberIdentityHints } from './headers';

/**
 * Browser identity consistency for every Space, independent of fingerprint protection. Electron
 * reports the Chromium brand list in Sec-CH-UA and navigator.userAgentData like any Chromium
 * browser; what gives it away as an embedded browser (Google sign-in: "This browser or app may not
 * be secure") is everything around that:
 *  - the full build number in the User-Agent (Chromium freezes it to "<major>.0.0.0"): privacy.ts;
 *  - an empty `window.chrome` (no app / csi / loadTimes): the identity preload;
 *  - missing high-entropy Sec-CH-UA-* hints after Accept-CH: headers.ts;
 *  - Accept-Language / navigator.languages reduced to the UI locale: privacy.ts.
 */

const PRELOAD = join(__dirname, '..', 'preload', 'identity.js');
const PRELOAD_ID = 'vela-identity';

export function initIdentity(): void {
  ipcMain.on(IDENTITY_HINTS_CHANNEL, (_event, raw: unknown) => rememberIdentityHints(raw));
  onSessionCreated((session) => {
    if (session.getPreloadScripts().some((script) => script.id === PRELOAD_ID)) return;
    session.registerPreloadScript({ id: PRELOAD_ID, type: 'frame', filePath: PRELOAD });
  });
}
