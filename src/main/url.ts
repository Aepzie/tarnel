import { canonicalInternalUrl, isInternalUrl } from '../shared/internal-url';
import type { SearchEngine } from '../shared/types';
import { upgradeToHttps } from './privacy';
import { getSettings } from './settings';

export { isInternalUrl };

export const NEWTAB_URL = 'tarnel://newtab/';

const SEARCH_BASE: Record<SearchEngine, string> = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
  startpage: 'https://www.startpage.com/sp/search?query=',
  ecosia: 'https://www.ecosia.org/search?q=',
};

const NAVIGABLE_SCHEMES = new Set(['http', 'https', 'tarnel', 'vela', 'about', 'file', 'data']);
const BLOCKED_SCHEMES = new Set(['javascript', 'vbscript']);
/** data: URLs are only allowed for inert content types. */
const SAFE_DATA = /^data:(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)|text\/plain|application\/pdf)[;,]/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export interface ResolvedInput {
  kind: 'url' | 'search';
  url: string;
}

export function searchUrl(query: string, engine: SearchEngine): string {
  return (SEARCH_BASE[engine] ?? SEARCH_BASE.duckduckgo) + encodeURIComponent(query.trim());
}

function isIPv4(host: string): boolean {
  const m = IPV4.exec(host);
  return !!m && m.slice(1).every((part) => Number(part) <= 255);
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || isIPv4(host) || host.startsWith('[');
}

/** Host[:port][/path] without scheme that is plausibly a domain, localhost or an IP. */
function looksLikeHost(input: string): string | null {
  if (/\s/.test(input)) return null;
  const hostPort = input.split(/[/?#]/, 1)[0] ?? '';
  if (!hostPort || hostPort.includes('@')) return null;
  const ipv6 = /^\[[0-9a-f:.]+\](:\d{1,5})?$/i.test(hostPort);
  if (ipv6) return hostPort.slice(0, hostPort.indexOf(']') + 1).toLowerCase();
  const [host = '', port, extra] = hostPort.toLowerCase().split(':');
  if (extra !== undefined) return null;
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return null;
  if (host === 'localhost' || isIPv4(host)) return host;
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  const tld = host.slice(host.lastIndexOf('.') + 1);
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]+)$/.test(tld)) return null;
  return host;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function withScheme(url: URL, httpsOnly: boolean): string | null {
  const scheme = url.protocol.slice(0, -1);
  if (scheme === 'about') return url.href === 'about:blank' ? url.href : null;
  if (scheme === 'data') return SAFE_DATA.test(url.href) ? url.href : null;
  if (scheme === 'http' && httpsOnly) return upgradeToHttps(url.href);
  return canonicalInternalUrl(url.href);
}

/**
 * Resolve raw address-bar text to a navigable URL or a search. Returns null for blocked input
 * (javascript:, disallowed data:, unsupported about: pages).
 */
export function resolveInputDetailed(
  input: string,
  engine: SearchEngine,
  httpsOnly: boolean = getSettings().httpsOnly,
): ResolvedInput | null {
  const text = input.trim();
  if (!text) return null;
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  const scheme = schemeMatch?.[1]?.toLowerCase() ?? '';
  if (BLOCKED_SCHEMES.has(scheme)) return null;

  if (NAVIGABLE_SCHEMES.has(scheme) && (scheme !== 'http' && scheme !== 'https' ? true : /^https?:\/\//i.test(text))) {
    const url = parse(text);
    if (!url) return { kind: 'search', url: searchUrl(text, engine) };
    const resolved = withScheme(url, httpsOnly);
    return resolved ? { kind: 'url', url: resolved } : null;
  }

  // Unknown scheme with authority (chrome://, ftp://…) → treat as a search.
  if (schemeMatch && text.slice(schemeMatch[0].length).startsWith('//')) {
    return { kind: 'search', url: searchUrl(text, engine) };
  }

  const host = looksLikeHost(text);
  if (host) {
    const prefix = isLocalHost(host) ? 'http://' : 'https://';
    const url = parse(prefix + text);
    if (url) return { kind: 'url', url: url.href };
  }
  return { kind: 'search', url: searchUrl(text, engine) };
}

export function resolveInput(input: string, engine: SearchEngine): string | null {
  return resolveInputDetailed(input, engine)?.url ?? null;
}

/** URLs that web content (window.open, links) may open as a new tab. */
export function isOpenableFromWeb(url: string): boolean {
  return /^(https?:|about:blank$)/i.test(url);
}

export function isSecureUrl(url: string): boolean {
  return /^(https|tarnel|vela):/i.test(url);
}
