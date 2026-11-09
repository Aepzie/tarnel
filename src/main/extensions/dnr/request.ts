import { registrableDomain } from '../../net/domain';
import { methodBit, typeBit } from './rule';
import type { RequestInfo, RequestMethod, ResourceType } from './types';

/** Electron webRequest resourceType → declarativeNetRequest ResourceType. */
const ELECTRON_TYPES: Record<string, ResourceType> = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other',
};

export function dnrResourceType(electronType: string | undefined): ResourceType {
  return (electronType && ELECTRON_TYPES[electronType]) || 'other';
}

const METHODS = new Set<string>(['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put']);

/** Schemes declarativeNetRequest acts on. */
const SCHEMES = new Set(['http', 'https', 'ws', 'wss', 'ftp']);

interface Location {
  scheme: string;
  host: string;
  hostStart: number;
  hostEnd: number;
}

/** Fast authority split for canonical URLs (Chromium already canonicalized them). */
function locate(url: string): Location | null {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd <= 0) return null;
  const scheme = url.slice(0, schemeEnd).toLowerCase();
  let start = schemeEnd + 3;
  let end = url.length;
  for (let i = start; i < url.length; i += 1) {
    const code = url.charCodeAt(i);
    if (code === 47 || code === 63 || code === 35) {
      end = i;
      break;
    }
  }
  const at = url.lastIndexOf('@', end - 1);
  if (at >= start) start = at + 1;
  let hostEnd = end;
  if (url.charCodeAt(start) === 91) {
    const close = url.indexOf(']', start);
    if (close > start && close < end) hostEnd = close + 1;
  } else {
    const colon = url.indexOf(':', start);
    if (colon >= start && colon < end) hostEnd = colon;
  }
  let host = url.slice(start, hostEnd).toLowerCase();
  if (host.startsWith('[')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host) return null;
  return { scheme, host, hostStart: start, hostEnd };
}

export function hostOf(url: string): string | null {
  return locate(url)?.host ?? null;
}

export interface RequestInput {
  url: string;
  type: ResourceType;
  method?: string;
  /** Initiator origin (`https://example.com`), `null`/absent for browser-initiated requests. */
  initiator?: string | null;
  tabId?: number;
  responseHeaders?: Record<string, string[]>;
}

/** Build the matcher's view of a request; null when DNR does not apply to the URL's scheme. */
export function createRequestInfo(input: RequestInput): RequestInfo | null {
  const location = locate(input.url);
  if (!location || !SCHEMES.has(location.scheme)) return null;
  const initiatorHost = input.initiator && input.initiator !== 'null' ? hostOf(input.initiator) : null;
  const lowerMethod = (input.method ?? 'get').toLowerCase();
  const method = (METHODS.has(lowerMethod) ? lowerMethod : 'other') as RequestMethod;
  const thirdParty = initiatorHost !== null && registrableDomain(initiatorHost) !== registrableDomain(location.host);
  return {
    url: input.url,
    lowerUrl: input.url.toLowerCase(),
    scheme: location.scheme,
    host: location.host,
    hostStart: location.hostStart,
    hostEnd: location.hostEnd,
    type: input.type,
    method,
    typeBit: typeBit(input.type),
    methodBit: methodBit(method),
    initiatorHost,
    thirdParty,
    tabId: input.tabId ?? -1,
    responseHeaders: input.responseHeaders,
  };
}
