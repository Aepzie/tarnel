/**
 * MantelVPN contract shared by main (API client, Space proxy routing) and the chrome UI (VPN panel).
 * Pure: no electron imports, so the parsers below are unit-tested directly.
 *
 * API shapes mirror the public Mantel Windows client (github.com/Mantel-Collective-LLC/mantel-windows,
 * GPL-3.0; only the wire format is reused, no code). See docs/ARCHITECTURE.md → VPN (MantelVPN).
 */

export const VPN_IPC = {
  state: 'chrome:vpn-state',
  login: 'chrome:vpn-login',
  verifyTotp: 'chrome:vpn-verify-totp',
  logout: 'chrome:vpn-logout',
  refresh: 'chrome:vpn-refresh',
  connect: 'chrome:vpn-connect',
  disconnect: 'chrome:vpn-disconnect',
  changed: 'chrome-event:vpn',
} as const;

export const MANTEL_API_URL = 'https://mantelvpn.com';
export const ACCOUNT_DIGITS = 16;

/** "live" = signed in against the Mantel API; "preview" = API unreachable, simulated data. */
export type VpnMode = 'signed-out' | 'live' | 'preview';
export type VpnLocationStatus = 'paused' | 'upgrading' | 'full';

export interface VpnServer {
  id: string;
  country: string;
  countryCode: string;
  city: string;
  online: boolean;
  /** Mantel reports no load; preview data does. */
  load: number | null;
  /** Round trip in ms when known. */
  ping: number | null;
  status: VpnLocationStatus | null;
}

export interface VpnConnection {
  serverId: string;
  spaceId: string;
  /** host:port of the Mantel proxy the Space routes through. */
  proxy: string;
  connectedAt: number;
}

export interface VpnState {
  mode: VpnMode;
  /** Last four digits only; the full number never leaves main. */
  accountTail: string | null;
  paidUntil: string | null;
  servers: VpnServer[];
  connection: VpnConnection | null;
  /** Last API problem, shown in the panel. */
  notice: string | null;
  /** Mantel asked for a two-factor code (sign-in or an expired session); the panel shows the code field. */
  totpRequired: boolean;
}

export type VpnResult = { ok: true; state: VpnState } | { ok: false; error: string; state: VpnState };

/** Digits only; spaces, dashes and dots from a paste are dropped. Null unless exactly 16 digits remain. */
export function normalizeAccountNumber(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const compact = raw.replace(/[\s\-. ]/g, '');
  return /^\d{16}$/.test(compact) ? compact : null;
}

/** A two-factor code from an authenticator app: 6–8 digits, spaces dropped. Null otherwise. */
export function normalizeTotp(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 32) return null;
  const compact = raw.replace(/\s/g, '');
  return /^\d{6,8}$/.test(compact) ? compact : null;
}

/** Groups digits in fours for display while typing ("1234 5678 9…"); non-digits are dropped. */
export function formatAccountNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, ACCOUNT_DIGITS);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

const COUNTRY_NAMES: Record<string, string> = {
  AT: 'Austria', AU: 'Australia', BE: 'Belgium', BR: 'Brazil', CA: 'Canada', CH: 'Switzerland', CZ: 'Czechia',
  DE: 'Germany', DK: 'Denmark', ES: 'Spain', FI: 'Finland', FR: 'France', GB: 'United Kingdom', HK: 'Hong Kong',
  IE: 'Ireland', IS: 'Iceland', IT: 'Italy', JP: 'Japan', NL: 'Netherlands', NO: 'Norway', PL: 'Poland',
  PT: 'Portugal', RO: 'Romania', SE: 'Sweden', SG: 'Singapore', US: 'United States',
};

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN = /^[A-Za-z0-9._~+/=-]{16,512}$/;
const HOST = /^(?:[A-Za-z0-9-]{1,63}\.)*[A-Za-z0-9-]{1,63}$|^[0-9a-fA-F:.]{2,45}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isoDate(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : null;
}

function port(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
}

/** POST /api/v1/auth/login → { token, account: { id, paidUntil } } */
export function parseLogin(body: unknown): { token: string; paidUntil: string } | null {
  const root = record(body);
  const account = record(root?.account);
  const paidUntil = isoDate(account?.paidUntil);
  if (!root || typeof root.token !== 'string' || !TOKEN.test(root.token) || !paidUntil) return null;
  return { token: root.token, paidUntil };
}

/** GET /api/v1/account → { id, paidUntil, graceUntil?, settings, devices[] } (only the expiry is used). */
export function parseAccount(body: unknown): { paidUntil: string } | null {
  const paidUntil = isoDate(record(body)?.paidUntil);
  return paidUntil ? { paidUntil } : null;
}

/** GET /api/v1/nodes → [{ id, city, country, endpointHost, endpointPort, online, latencyMs?, status? }] */
export function parseNodes(body: unknown): VpnServer[] | null {
  if (!Array.isArray(body) || body.length > 500) return null;
  const servers: VpnServer[] = [];
  for (const entry of body) {
    const node = record(entry);
    if (!node) continue;
    const { id, city, country, online, latencyMs, status } = node;
    if (typeof id !== 'string' || !IDENTIFIER.test(id)) continue;
    if (typeof city !== 'string' || city.length < 1 || city.length > 64) continue;
    if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) continue;
    servers.push({
      id,
      city,
      countryCode: country,
      country: countryName(country),
      online: online === true,
      load: null,
      ping: typeof latencyMs === 'number' && Number.isInteger(latencyMs) && latencyMs >= 0 && latencyMs <= 10_000 ? latencyMs : null,
      status: status === 'paused' || status === 'upgrading' || status === 'full' ? status : null,
    });
  }
  return servers;
}

export interface MantelProxy {
  id: string;
  name: string;
  nodeId: string;
  host: string;
  port: number;
  protocol: 'socks5' | 'http' | 'mtproto';
  exit: 'tor' | 'direct';
  username: string;
  enabled: boolean;
  status: 'active' | 'pending' | 'unavailable';
}

function parseProxy(value: unknown): MantelProxy | null {
  const proxy = record(value);
  if (!proxy) return null;
  const { id, name, nodeId, host, protocol, exit, username, enabled, status } = proxy;
  const proxyPort = port(proxy.port);
  if (typeof id !== 'string' || !IDENTIFIER.test(id) || typeof nodeId !== 'string' || !IDENTIFIER.test(nodeId)) return null;
  if (typeof host !== 'string' || host.length > 253 || !HOST.test(host) || proxyPort === null) return null;
  if (protocol !== 'socks5' && protocol !== 'http' && protocol !== 'mtproto') return null;
  if (exit !== 'tor' && exit !== 'direct') return null;
  if (typeof username !== 'string' || username.length > 64) return null;
  return {
    id,
    name: typeof name === 'string' ? name.slice(0, 64) : '',
    nodeId,
    host,
    port: proxyPort,
    protocol,
    exit,
    username,
    enabled: enabled === true,
    status: status === 'active' || status === 'pending' ? status : 'unavailable',
  };
}

/** GET /api/v1/proxies → { proxies: [...] } */
export function parseProxyList(body: unknown): MantelProxy[] | null {
  const list = record(body)?.proxies;
  if (!Array.isArray(list) || list.length > 100) return null;
  return list.map(parseProxy).filter((proxy): proxy is MantelProxy => proxy !== null);
}

/** POST /api/v1/proxies → { proxy, password } (the password is returned only once). */
export function parseProxyWithPassword(body: unknown): { proxy: MantelProxy; password: string } | null {
  const root = record(body);
  const proxy = parseProxy(root?.proxy);
  const password = root?.password;
  if (!proxy || typeof password !== 'string' || password.length < 1 || password.length > 128) return null;
  return { proxy, password };
}

/** Mantel error body: { code?, error?, params? }. */
export function parseApiError(body: unknown): { code: string | null; message: string | null } {
  const root = record(body);
  const code = typeof root?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(root.code) ? root.code : null;
  const message = typeof root?.error === 'string' ? root.error.slice(0, 300) : null;
  return { code, message };
}

/** Short, user-facing copy for an API error code / status. Unknown codes fall back to Mantel's own text. */
export function describeApiError(status: number, code: string | null, serverMessage: string | null = null): string {
  switch (code) {
    case 'invalid_code':
      return 'An account number has exactly 16 digits.';
    case 'unknown_code':
    case 'account_not_found':
      return 'This account number does not exist.';
    case 'totp_required':
      return 'Enter the code from your authenticator app.';
    case 'totp_invalid':
      return 'That code did not work. Enter the current code from your authenticator app.';
    case 'account_expired':
      return 'This Mantel account has no active time left.';
    case 'device_limit_reached':
      return 'This Mantel account has reached its device limit.';
    case 'device_locked':
      return 'This device is locked on your Mantel account.';
    case 'location_paused':
    case 'location_upgrading':
    case 'location_full':
    case 'node_unavailable':
      return 'This location is not available right now. Pick another one.';
    case 'rate_limited':
      return 'Too many attempts. Try again in a minute.';
    case 'unauthorized':
      return 'Your Mantel session ended. Sign in again.';
  }
  if (status === 429) return 'Too many attempts. Try again in a minute.';
  if (status === 401) return 'Your Mantel session ended. Sign in again.';
  if (status >= 500) return 'Mantel is having trouble right now. Try again later.';
  const detail = code ? ` (${code}, ${status})` : ` (${status})`;
  return serverMessage ? `Mantel: ${serverMessage}${detail}` : `Mantel answered with an error${detail}.`;
}
