import type { IdentityHints } from '../../shared/identity';

/**
 * Electron has no client-hints delegate, so its network stack sends no Sec-CH-UA* on navigations
 * (Chromium sends the three low-entropy hints on every request to a secure origin) and ignores
 * Accept-CH (no high-entropy hints ever). Pages' own subresource requests do carry the low-entropy
 * set. Both gaps are filled here with exactly the values navigator.userAgentData reports, which the
 * chrome UI and the identity preload send once. No imports from spaces.ts: privacy.ts calls this
 * and spaces.ts imports privacy.ts.
 */

let hints: IdentityHints | null = null;

const isString = (value: unknown, max = 64): value is string => typeof value === 'string' && value.length <= max;

function isBrandList(value: unknown): value is { brand: string; version: string }[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 6 && value.every((entry) => entry && isString(entry.brand) && isString(entry.version));
}

/** Stores the first valid report from an identity preload; later reports are ignored. */
export function rememberIdentityHints(raw: unknown): void {
  if (hints) return;
  hints = parseHints(raw);
}

function parseHints(raw: unknown): IdentityHints | null {
  if (!raw || typeof raw !== 'object') return null;
  const values = raw as Record<string, unknown>;
  if (!isBrandList(values.brands) || !isBrandList(values.fullVersionList)) return null;
  const fields = ['platform', 'architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion'] as const;
  if (!fields.every((field) => isString(values[field]))) return null;
  if (typeof values.mobile !== 'boolean' || typeof values.wow64 !== 'boolean') return null;
  return values as unknown as IdentityHints;
}

interface Destination {
  secure: boolean;
  host: string;
}

/** Client hints go only to potentially trustworthy origins: https/wss, or plain http on loopback. */
function destinationOf(url: string): Destination | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host);
  const secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:' || (parsed.protocol === 'http:' && loopback);
  return { secure, host };
}

/**
 * Hosts that ask for the full hint set with Accept-CH on every response and judge the browser by
 * it (Google sign-in, including its accounts.youtube.com hop). Kept to these: elsewhere the
 * high-entropy values are only available to script, as in a browser that was never asked for them.
 */
function wantsHighEntropyHints(host: string): boolean {
  return host === 'accounts.youtube.com' || /^accounts\.google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host);
}

const quoted = (value: string): string => `"${value.replace(/["\\]/g, '')}"`;
const brandList = (brands: { brand: string; version: string }[]): string =>
  brands.map(({ brand, version }) => `${quoted(brand)};v=${quoted(version)}`).join(', ');

function setIfAbsent(headers: Record<string, string>, name: string, value: string): void {
  const lower = name.toLowerCase();
  if (Object.keys(headers).some((key) => key.toLowerCase() === lower)) return;
  headers[name] = value;
}

/**
 * Adds the hints a stock Chromium would send: the low-entropy set on every secure request that
 * lacks it, the high-entropy set to the account hosts. Runs before applyFingerprintHeaders, so
 * strict Spaces reduce them the same way they reduce getHighEntropyValues().
 */
export function applyIdentityHeaders(url: string, headers: Record<string, string>): void {
  if (!hints) return;
  const destination = destinationOf(url);
  if (!destination?.secure) return;
  setIfAbsent(headers, 'sec-ch-ua', brandList(hints.brands));
  setIfAbsent(headers, 'sec-ch-ua-mobile', hints.mobile ? '?1' : '?0');
  setIfAbsent(headers, 'sec-ch-ua-platform', quoted(hints.platform));
  if (!wantsHighEntropyHints(destination.host)) return;
  setIfAbsent(headers, 'sec-ch-ua-arch', quoted(hints.architecture));
  setIfAbsent(headers, 'sec-ch-ua-bitness', quoted(hints.bitness));
  setIfAbsent(headers, 'sec-ch-ua-full-version', quoted(hints.uaFullVersion));
  setIfAbsent(headers, 'sec-ch-ua-full-version-list', brandList(hints.fullVersionList));
  setIfAbsent(headers, 'sec-ch-ua-model', quoted(hints.model));
  setIfAbsent(headers, 'sec-ch-ua-platform-version', quoted(hints.platformVersion));
  setIfAbsent(headers, 'sec-ch-ua-wow64', hints.wow64 ? '?1' : '?0');
}
