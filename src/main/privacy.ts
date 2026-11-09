import { app, type Session, type WebContents } from 'electron';
import type { PermissionKind, PermissionRequest, Space } from '../shared/types';
import { getSettings } from './settings';

type Permission = Parameters<NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>>[1];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strips " Electron/x.y.z" and " <appName>/x.y.z" so sites see a stock Chrome UA. */
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
    .replace(/\s{2,}/g, ' ')
    .trim();
}

let globalUaApplied = false;

/** Sets app.userAgentFallback once; call after app 'ready'. */
export function applyGlobalUserAgent(): void {
  if (globalUaApplied) return;
  globalUaApplied = true;
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
}

// ---------------------------------------------------------------------------
// Registrable domain (eTLD+1) heuristic
// ---------------------------------------------------------------------------

/** Common multi-label public suffixes. Not the full PSL, but covers the vast majority of real traffic. */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'org.nz', 'net.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp', 'ed.jp', 'gr.jp', 'lg.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw',
  'com.sg', 'edu.sg', 'gov.sg', 'org.sg', 'net.sg',
  'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'ac.in', 'edu.in', 'gov.in',
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'net.mx',
  'com.ar', 'org.ar', 'gob.ar', 'net.ar',
  'co.za', 'org.za', 'gov.za', 'ac.za', 'net.za',
  'com.tr', 'org.tr', 'net.tr', 'gov.tr', 'edu.tr',
  'com.ua', 'org.ua', 'net.ua', 'gov.ua',
  'co.il', 'org.il', 'ac.il', 'gov.il',
  'com.my', 'org.my', 'gov.my', 'edu.my',
  'co.id', 'or.id', 'go.id', 'ac.id', 'web.id',
  'co.th', 'or.th', 'go.th', 'ac.th', 'in.th',
  'com.vn', 'com.ph', 'com.pk', 'com.eg', 'com.sa', 'com.co', 'com.pe', 'com.ve', 'com.ng', 'com.pl',
  'com.es', 'com.pt', 'com.ru', 'com.gr', 'co.at', 'or.at', 'gv.at', 'co.hu',
  // Popular private suffixes (each subdomain is a different owner).
  'github.io', 'gitlab.io', 'githubusercontent.com', 'herokuapp.com', 'netlify.app', 'vercel.app',
  'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'appspot.com', 'blogspot.com',
  'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'fly.dev', 'onrender.com', 'glitch.me',
  'repl.co', 'surge.sh', 'neocities.org', 'wordpress.com', 'tumblr.com', 'substack.com',
]);

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || isIpAddress(h)) return h;
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const lastThree = labels.slice(-3).join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return lastThree;
  if (labels.length >= 4 && MULTI_LABEL_SUFFIXES.has(lastThree)) return labels.slice(-4).join('.');
  return lastTwo;
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
// HTTPS upgrade (used by tabs.ts; webRequest.onBeforeRequest is reserved for the adblocker)
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

const configured = new WeakSet<Session>();

export function applyPrivacy(session: Session, space: Space): void {
  scopes.set(session, { session, spaceId: space.id, ephemeral: space.ephemeral });
  if (configured.has(session)) return;
  configured.add(session);

  session.setUserAgent(cleanUserAgent(session.getUserAgent()));
  session.setSpellCheckerEnabled(false);

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let topUrl: string | undefined;
    try {
      topUrl = webContents.getURL();
    } catch {
      topUrl = undefined;
    }
    requestGrant(session, webContents, permission, details.isMainFrame, details.requestingUrl, topUrl, mediaTypesOf(details))
      .then(callback)
      .catch(() => callback(false));
  });

  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
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

  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const settings = getSettings();
    const headers = details.requestHeaders;
    if (settings.sendDoNotTrack) {
      headers['DNT'] = '1';
      headers['Sec-GPC'] = '1';
    }
    if (settings.blockThirdPartyCookies && details.resourceType !== 'mainFrame') {
      const requestSite = siteOf(details.url);
      const topSite = siteOf(topFrameUrl(details)) ?? siteOf(details.initiatorOrigin);
      if (requestSite && topSite && requestSite !== topSite) {
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === 'cookie') delete headers[name];
        }
      }
    }
    callback({ requestHeaders: headers });
  });
}
