import { app, webContents, type Session } from 'electron';
import type { SpaceId } from '../shared/types';
import { cleanUserAgent } from './privacy';
import { userAgentOverrideOf } from './site-rules/overrides';
import { getSettings, onSettingsChanged } from './settings';
import { getSpace, onSessionCreated, onSessionRemoved, onSpacesChanged } from './spaces';

/**
 * User-Agent per Space: the Space's own value, else the global setting, else Tarnel's clean Chromium
 * UA (privacy.ts). Applied to the session (network + new pages) and to its open pages (next load).
 * Tabs with a site-rule UA (site-rules/overrides.ts) keep theirs: rule > Space > global.
 * Accept-Language is left untouched (setUserAgent without the second argument keeps it).
 */

const sessions = new Map<Session, SpaceId>();

function wantedFor(spaceId: SpaceId): string {
  return getSpace(spaceId)?.userAgent || getSettings().userAgent || cleanUserAgent(app.userAgentFallback);
}

function apply(session: Session, spaceId: SpaceId): void {
  const ua = wantedFor(spaceId);
  try {
    if (session.getUserAgent() !== ua) session.setUserAgent(ua);
  } catch {
    return; /* session gone */
  }
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed() || wc.session !== session || wc.getUserAgent() === ua || userAgentOverrideOf(wc)) continue;
    wc.setUserAgent(ua);
  }
}

function syncAll(): void {
  for (const [session, spaceId] of sessions) apply(session, spaceId);
}

export function initUserAgent(): void {
  onSessionCreated((session, space) => {
    sessions.set(session, space.id);
    apply(session, space.id);
  });
  onSessionRemoved((session) => sessions.delete(session));
  onSpacesChanged(syncAll);
  let last = getSettings().userAgent;
  onSettingsChanged((settings) => {
    if (settings.userAgent === last) return;
    last = settings.userAgent;
    syncAll();
  });
}
