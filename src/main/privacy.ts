import { app, type Session, type WebContents } from 'electron';
import type { PermissionKind, PermissionRequest, Space } from '../shared/types';
import { applyFingerprintHeaders } from './fingerprint/headers';
import { applyIdentityHeaders } from './identity/headers';
import { registrableDomain } from './net/domain';
import { cleanUrl } from '../shared/url-clean';
import { addWebRequestStage, removeWebRequestStage, STAGE_ORDER } from './net/dispatcher';
import { trimReferrer } from './net/referrer';
import { getSettings, onSettingsChanged } from './settings';

export { registrableDomain } from './net/domain';

type Permission = Parameters<NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>>[1];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strips " Electron/x.y.z" and " <appName>/x.y.z" and freezes the Chrome version to "<major>.0.0.0"
 * (User-Agent reduction: real Chromium browsers never put the build number in the UA, it is only
 * available through the Sec-CH-UA-Full-Version-List hint), so sites see a stock Chromium UA.
 */
export function cleanUserAgent(ua: string): string {
  const names = new Set(['electron', 'vela']);
  try {
    const appName = app.getName().trim();
    if (appName) names.add(appName.toLowerCase());
  } catch {
    /* app not available (tests) */
  }
  const alternatives = [...names].map((n) => escapeRegExp(n).replace(/\\? /g, '[ -]?')).join('|');
  return ua
    .replace(new RegExp(`\\s+(?:${alternatives})\\/\\S+`, 'gi'), '')
    .replace(/\bChrome\/(\d+)(?:\.\d+)+/, 'Chrome/$1.0.0.0')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The Accept-Language list. Electron's renderer reports navigator.languages as the UI locale
 * followed by the OS languages ("de", "de-DE"), but its network stack sends only the UI locale
 * ("de"); in Chromium both come from the same list. Returns that list so the header matches.
 */
export function acceptLanguages(): string {
  const tags: string[] = [];
  try {
    tags.push(app.getLocale(), ...app.getPreferredSystemLanguages());
  } catch {
    /* app not ready (tests) */
  }
  const languages: string[] = [];
  for (const tag of tags) {
    const clean = tag.replace(/_/g, '-').trim();
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(clean)) continue;
    if (!languages.some((known) => known.toLowerCase() === clean.toLowerCase())) languages.push(clean);
  }
  return languages.join(',');
}

let globalUaApplied = false;

/** Sets app.userAgentFallback once; call after app 'ready'. */
export function applyGlobalUserAgent(): void {
  if (globalUaApplied) return;
  globalUaApplied = true;
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
}

function siteOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    return registrableDomain(parsed.hostname);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTPS upgrade (used by tabs.ts for navigations; not a webRequest stage)
// ---------------------------------------------------------------------------

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  if (!h.includes('.') && !h.includes(':')) return true; // single-label intranet names
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export function upgradeToHttps(url: string): string {
  if (!/^http:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (isLocalHost(parsed.hostname)) return url;
    parsed.protocol = 'https:';
    if (parsed.port === '80') parsed.port = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Session hardening
// ---------------------------------------------------------------------------

const ALWAYS_ALLOWED = new Set<Permission>(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Permissions that are never granted silently: the user is asked in the chrome, per origin per Space. */
const PROMPTABLE: ReadonlySet<string> = new Set<PermissionKind>(['media', 'geolocation', 'notifications']);

function isPromptable(permission: string): permission is PermissionKind {
  return PROMPTABLE.has(permission);
}

export interface PermissionScope {
  session: Session;
  spaceId: string;
  ephemeral: boolean;
}

/**
 * Bridge to the in-chrome prompt (permissions.ts). Injected from index.ts so this module never
 * imports window/tabs (spaces.ts imports privacy.ts — a direct import would form a cycle).
 */
export interface PermissionPrompter {
  request(request: Omit<PermissionRequest, 'id'>, webContents: WebContents, scope: PermissionScope): Promise<boolean>;
  remembered(scope: PermissionScope, origin: string, permission: PermissionKind, mediaTypes?: ('video' | 'audio')[]): boolean | undefined;
  granted(scope: PermissionScope, origin: string, permission: PermissionKind, mediaType?: string): boolean;
}

let prompter: PermissionPrompter | null = null;

export function setPermissionPrompter(next: PermissionPrompter): void {
  prompter = next;
}

const scopes = new WeakMap<Session, PermissionScope>();

/** Per-tab media devices (audio-devices/index.ts), injected for the same no-cycle reason as the prompter. */
export interface MediaPermissionHooks {
  /** Expose device ids/labels (and non-default setSinkId) to every frame of a tab the user routed. */
  allowsDeviceAccess(webContents: WebContents | null, mediaType: string | undefined): boolean;
  granted(webContents: WebContents, mediaTypes: ('video' | 'audio')[]): void;
}

let mediaHooks: MediaPermissionHooks | null = null;

export function setMediaPermissionHooks(next: MediaPermissionHooks): void {
  mediaHooks = next;
}

function sameOriginTop(requestingUrl: string | undefined, topUrl: string | undefined): string | null {
  const requesting = originOf(requestingUrl);
  const top = originOf(topUrl);
  if (!requesting || !top || requesting !== top) return null;
  return requesting;
}

function checkGrant(session: Session, permission: string, isMainFrame: boolean, requestingUrl: string | undefined, topUrl: string | undefined, mediaType?: string): boolean {
  if (ALWAYS_ALLOWED.has(permission as Permission)) return true;
  if (!isPromptable(permission) || !isMainFrame) return false;
  const origin = sameOriginTop(requestingUrl, topUrl);
  const scope = scopes.get(session);
  if (!origin || !scope || !prompter) return false;
  return prompter.granted(scope, origin, permission, mediaType);
}

function mediaTypesOf(details: unknown): ('video' | 'audio')[] | undefined {
  const raw = (details as { mediaTypes?: unknown }).mediaTypes;
  if (!Array.isArray(raw)) return undefined;
  const types = raw.filter((type): type is 'video' | 'audio' => type === 'video' || type === 'audio');
  return types.length > 0 ? [...new Set(types)] : undefined;
}

async function requestGrant(
  session: Session,
  webContents: WebContents,
  permission: string,
  isMainFrame: boolean,
  requestingUrl: string | undefined,
  topUrl: string | undefined,
  mediaTypes: ('video' | 'audio')[] | undefined,
): Promise<boolean> {
  if (ALWAYS_ALLOWED.has(permission as Permission)) return true;
  if (!isPromptable(permission) || !isMainFrame) return false;
  const origin = sameOriginTop(requestingUrl, topUrl);
  const scope = scopes.get(session);
  if (!origin || !scope || !prompter || webContents.isDestroyed()) return false;

  const wanted = permission === 'media' ? (mediaTypes ?? ['video', 'audio']) : undefined;
  const known = prompter.remembered(scope, origin, permission, wanted);
  if (known !== undefined) return known;

  return prompter.request(
    { tabId: null, origin, host: new URL(origin).host, permission, ...(wanted ? { mediaTypes: wanted } : {}) },
    webContents,
    scope,
  );
}

function topFrameUrl(details: { frame?: Electron.WebFrameMain | null; webContents?: Electron.WebContents; referrer: string }): string | undefined {
  try {
    const top = details.frame?.top?.url;
    if (top) return top;
  } catch {
    /* frame destroyed */
  }
  try {
    const wcUrl = details.webContents && !details.webContents.isDestroyed() ? details.webContents.getURL() : '';
    if (wcUrl) return wcUrl;
  } catch {
    /* webContents gone */
  }
  return details.referrer || undefined;
}

// ---------------------------------------------------------------------------
// Tracking parameters and referrers
// ---------------------------------------------------------------------------

type StrippedListener = (webContentsId: number, count: number) => void;
let strippedListener: StrippedListener | null = null;

/** Called with the tab's webContents id and the number of tracking parameters removed from a navigation. */
export function onTrackingStripped(listener: StrippedListener): void {
  strippedListener = listener;
}

function notifyStripped(webContentsId: number, count: number): void {
  try {
    strippedListener?.(webContentsId, count);
  } catch {
    /* counting must never break navigation */
  }
}

/** Cleans a URL the user is about to copy or open (no-op when the setting is off). */
export function cleanUserUrl(url: string): string {
  return getSettings().removeTrackingParams ? cleanUrl(url).url : url;
}

function applyReferrerTrim(requestUrl: string, headers: Record<string, string>): void {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() !== 'referer') continue;
    const trimmed = trimReferrer(headers[name], requestUrl);
    if (trimmed === null) delete headers[name];
    else headers[name] = trimmed;
  }
}

function urlCleanStage(details: Electron.OnBeforeRequestListenerDetails): Electron.CallbackResponse | void {
  if (details.resourceType !== 'mainFrame' || details.method !== 'GET') return;
  const cleaned = cleanUrl(details.url);
  // cleanUrl is idempotent, so the redirected request comes back unchanged: no loop.
  if (cleaned.removed.length === 0 || cleaned.url === details.url) return;
  if (details.webContentsId) notifyStripped(details.webContentsId, cleaned.removed.length);
  return { redirectURL: cleaned.url };
}

/**
 * The stage exists only while the setting is on: with it (and Ghostery, and DNR) off, no
 * onBeforeRequest listener is installed at all, so sub-resources never cross into JS for it.
 */
function syncUrlCleanStage(session: Session): void {
  if (getSettings().removeTrackingParams) addWebRequestStage(session, 'beforeRequest', 'url-clean', STAGE_ORDER.urlClean, urlCleanStage);
  else removeWebRequestStage(session, 'beforeRequest', 'url-clean');
}

const urlCleanSessions = new Set<WeakRef<Session>>();
let urlCleanWatched = false;
let urlCleanEnabled: boolean | null = null;

function watchUrlCleanSetting(): void {
  if (urlCleanWatched) return;
  urlCleanWatched = true;
  urlCleanEnabled = getSettings().removeTrackingParams;
  onSettingsChanged((settings) => {
    if (settings.removeTrackingParams === urlCleanEnabled) return;
    urlCleanEnabled = settings.removeTrackingParams;
    for (const ref of urlCleanSessions) {
      const session = ref.deref();
      if (session) syncUrlCleanStage(session);
      else urlCleanSessions.delete(ref);
    }
  });
}

const configured = new WeakSet<Session>();

export function applyPrivacy(session: Session, space: Space): void {
  scopes.set(session, { session, spaceId: space.id, ephemeral: space.ephemeral });
  if (configured.has(session)) return;
  configured.add(session);

  const languages = acceptLanguages();
  if (languages) session.setUserAgent(cleanUserAgent(session.getUserAgent()), languages);
  else session.setUserAgent(cleanUserAgent(session.getUserAgent()));
  session.setSpellCheckerEnabled(false);

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let topUrl: string | undefined;
    try {
      topUrl = webContents.getURL();
    } catch {
      topUrl = undefined;
    }
    requestGrant(session, webContents, permission, details.isMainFrame, details.requestingUrl, topUrl, mediaTypesOf(details))
      .then((allow) => {
        if (allow && permission === 'media') mediaHooks?.granted(webContents, mediaTypesOf(details) ?? ['video', 'audio']);
        callback(allow);
      })
      .catch(() => callback(false));
  });

  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'media' && mediaHooks?.allowsDeviceAccess(webContents, details.mediaType)) return true;
    let topUrl: string | undefined;
    try {
      topUrl = webContents?.getURL();
    } catch {
      topUrl = undefined;
    }
    return checkGrant(session, permission, details.isMainFrame, details.requestingUrl ?? requestingOrigin, topUrl, details.mediaType);
  });

  // WebUSB / WebHID / Web Serial: always denied.
  session.setDevicePermissionHandler(() => false);

  syncUrlCleanStage(session);
  urlCleanSessions.add(new WeakRef(session));
  watchUrlCleanSetting();

  addWebRequestStage(session, 'beforeSendHeaders', 'privacy', STAGE_ORDER.privacy, (details, headers) => {
    const settings = getSettings();
    if (settings.trimReferrers) applyReferrerTrim(details.url, headers);
    if (settings.sendDoNotTrack) {
      headers['DNT'] = '1';
      headers['Sec-GPC'] = '1';
    }
    applyIdentityHeaders(details.url, headers);
    applyFingerprintHeaders(session, headers);
    if (settings.blockThirdPartyCookies && details.resourceType !== 'mainFrame') {
      const requestSite = siteOf(details.url);
      const topSite = siteOf(topFrameUrl(details)) ?? siteOf(details.initiatorOrigin);
      if (requestSite && topSite && requestSite !== topSite) {
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === 'cookie') delete headers[name];
        }
      }
    }
  });
}
