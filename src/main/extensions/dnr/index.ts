import type { Session } from 'electron';
import { join } from 'node:path';
import { registerDnrApi, type Router } from './api';
import { setDnrHost, type DnrHost } from './engine';

export { deletePersisted as deleteDnrState } from './persist';
export { forgetDnrSession, loadDnr, unloadDnr, usesDnr } from './engine';

const PRELOAD = join(__dirname, '..', 'preload', 'dnr.js');
const preloaded = new WeakSet<Session>();

/**
 * Register the chrome.declarativeNetRequest preload. Must run BEFORE electron-chrome-extensions is
 * attached to the session: its preload freezes `chrome`, and session preloads run in registration
 * order.
 */
export function registerDnrPreload(session: Session): void {
  if (preloaded.has(session)) return;
  preloaded.add(session);
  session.registerPreloadScript({ id: 'vela-dnr-frame', type: 'frame', filePath: PRELOAD });
  session.registerPreloadScript({ id: 'vela-dnr-worker', type: 'service-worker', filePath: PRELOAD });
}

/** Wire the API handlers and the badge / permission / event bridge of an extension host. */
export function attachDnr(session: Session, spaceId: string, router: Router, host: DnrHost): void {
  registerDnrApi(router, session);
  setDnrHost(session, spaceId, host);
}
