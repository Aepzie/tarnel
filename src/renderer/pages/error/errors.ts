import {
  CircleAlert,
  Hourglass,
  Network,
  SearchX,
  ServerCrash,
  ShieldAlert,
  ShieldBan,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';

export interface ErrorCopy {
  title: string;
  desc: string;
  icon: LucideIcon;
  /** Danger-toned (security) errors use red instead of the Space accent. */
  danger?: boolean;
}

const NOT_FOUND: ErrorCopy = {
  title: "Can't find this site",
  desc: "The address couldn't be resolved. Check the spelling, or try again in a moment.",
  icon: SearchX,
};
const OFFLINE: ErrorCopy = {
  title: "You're offline",
  desc: 'Check your network connection, then try again.',
  icon: WifiOff,
};
const REFUSED: ErrorCopy = {
  title: 'Connection refused',
  desc: "The site isn't accepting connections right now.",
  icon: ServerCrash,
};
const TIMEOUT: ErrorCopy = {
  title: 'Took too long to respond',
  desc: "The server didn't respond in time. It may be busy or down.",
  icon: Hourglass,
};
const PRIVATE: ErrorCopy = {
  title: "Connection isn't private",
  desc: "The site's certificate couldn't be verified. Someone could be trying to intercept your connection.",
  icon: ShieldAlert,
  danger: true,
};
const INSECURE: ErrorCopy = {
  title: "Connection isn't secure",
  desc: 'The site sent an invalid or unsupported response over HTTPS.',
  icon: ShieldAlert,
  danger: true,
};
const PROXY: ErrorCopy = {
  title: 'Proxy failed',
  desc: "This Space's proxy didn't respond. Check the proxy in this Space's settings.",
  icon: Network,
};
const FALLBACK: ErrorCopy = {
  title: "Page didn't load",
  desc: 'Something went wrong while loading this page.',
  icon: CircleAlert,
};

const EXACT: Record<string, ErrorCopy> = {
  ERR_NAME_NOT_RESOLVED: NOT_FOUND,
  ERR_NAME_RESOLUTION_FAILED: { ...NOT_FOUND, desc: 'DNS lookup failed. Check your connection or DNS settings.' },
  ERR_ADDRESS_UNREACHABLE: { ...NOT_FOUND, title: "Can't reach this address", desc: 'The address is unreachable from your network.' },
  ERR_INTERNET_DISCONNECTED: OFFLINE,
  ERR_NETWORK_CHANGED: { ...OFFLINE, title: 'Your network changed', desc: 'The connection was interrupted by a network change.' },
  ERR_CONNECTION_REFUSED: REFUSED,
  ERR_CONNECTION_RESET: { ...REFUSED, title: 'Connection was reset', desc: 'The connection was interrupted before the page loaded.' },
  ERR_CONNECTION_CLOSED: { ...REFUSED, title: 'Connection closed', desc: 'The site closed the connection unexpectedly.' },
  ERR_EMPTY_RESPONSE: { ...REFUSED, title: 'No response', desc: 'The server closed the connection without sending any data.' },
  ERR_CONNECTION_TIMED_OUT: TIMEOUT,
  ERR_TIMED_OUT: TIMEOUT,
  ERR_BLOCKED_BY_CLIENT: { title: 'Blocked by Tarnel', desc: 'This request matched a tracker or ad filter.', icon: ShieldBan },
  ERR_BLOCKED_BY_ADMINISTRATOR: { title: 'Blocked', desc: 'This page has been blocked.', icon: ShieldBan },
  ERR_TOO_MANY_REDIRECTS: { ...FALLBACK, title: 'Too many redirects', desc: "The page keeps redirecting. Clearing this Space's data may help." },
  ERR_FILE_NOT_FOUND: { ...NOT_FOUND, title: 'File not found', desc: 'It may have been moved, edited or deleted.' },
};

/** Electron's did-fail-load passes a numeric code (-105) plus the symbolic name as description. */
const NUMERIC: Record<string, string> = {
  '-2': 'ERR_FAILED',
  '-7': 'ERR_TIMED_OUT',
  '-20': 'ERR_BLOCKED_BY_CLIENT',
  '-21': 'ERR_NETWORK_CHANGED',
  '-22': 'ERR_BLOCKED_BY_ADMINISTRATOR',
  '-100': 'ERR_CONNECTION_CLOSED',
  '-101': 'ERR_CONNECTION_RESET',
  '-102': 'ERR_CONNECTION_REFUSED',
  '-105': 'ERR_NAME_NOT_RESOLVED',
  '-106': 'ERR_INTERNET_DISCONNECTED',
  '-107': 'ERR_SSL_PROTOCOL_ERROR',
  '-109': 'ERR_ADDRESS_UNREACHABLE',
  '-111': 'ERR_TUNNEL_CONNECTION_FAILED',
  '-113': 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH',
  '-118': 'ERR_CONNECTION_TIMED_OUT',
  '-120': 'ERR_SOCKS_CONNECTION_FAILED',
  '-130': 'ERR_PROXY_CONNECTION_FAILED',
  '-137': 'ERR_NAME_RESOLUTION_FAILED',
  '-200': 'ERR_CERT_COMMON_NAME_INVALID',
  '-201': 'ERR_CERT_DATE_INVALID',
  '-202': 'ERR_CERT_AUTHORITY_INVALID',
  '-310': 'ERR_TOO_MANY_REDIRECTS',
  '-324': 'ERR_EMPTY_RESPONSE',
};

export function copyFor(code: string): ErrorCopy {
  const exact = EXACT[code];
  if (exact) return exact;
  if (code.startsWith('ERR_CERT_')) return PRIVATE;
  if (code.startsWith('ERR_SSL_')) return INSECURE;
  if (code.startsWith('ERR_PROXY_') || code === 'ERR_TUNNEL_CONNECTION_FAILED' || code.startsWith('ERR_SOCKS_')) {
    return PROXY;
  }
  return FALLBACK;
}

export function isFallback(copy: ErrorCopy): boolean {
  return copy === FALLBACK;
}

const normalize = (raw: string | null): string =>
  (raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/^NET::/, '')
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 64);

export interface ParsedError {
  /** Symbolic code, e.g. ERR_NAME_NOT_RESOLVED. */
  code: string;
  /** Numeric net error, e.g. -105, when provided. */
  numeric: string | null;
  /** Free-form description from the URL when it isn't just the symbolic code. */
  detail: string;
  target: URL | null;
}

function httpUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function parseError(search: string): ParsedError {
  const params = new URLSearchParams(search);
  const rawDesc = (params.get('desc') ?? '').trim().slice(0, 200);
  const rawCode = normalize(params.get('code'));
  const descCode = normalize(rawDesc);
  const numeric = /^-?\d+$/.test(rawCode) ? (rawCode.startsWith('-') ? rawCode : `-${rawCode}`) : null;

  let code = 'ERR_FAILED';
  if (rawCode.startsWith('ERR_')) code = rawCode;
  else if (descCode.startsWith('ERR_')) code = descCode;
  else if (numeric && NUMERIC[numeric]) code = NUMERIC[numeric]!;

  return {
    code,
    numeric: numeric === '-0' ? null : numeric,
    detail: descCode.startsWith('ERR_') ? '' : rawDesc,
    target: httpUrl(params.get('url')),
  };
}
