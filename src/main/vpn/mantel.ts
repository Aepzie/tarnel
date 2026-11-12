import { app, net } from 'electron';
import {
  MANTEL_API_URL,
  describeApiError,
  parseAccount,
  parseApiError,
  parseLogin,
  parseNodes,
  parseProxyList,
  parseProxyWithPassword,
  type MantelProxy,
  type VpnServer,
} from '../../shared/vpn';

/**
 * Minimal MantelVPN API client (main process only). Wire format follows the public Mantel Windows
 * client; requests go through Electron's `net.fetch` (Chromium network stack, system proxy aware) with a
 * timeout, no redirects and a body size cap. Account numbers and tokens are never logged.
 */

const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 1024 * 1024;

export class MantelError extends Error {
  constructor(
    message: string,
    /** "network" = API unreachable (→ preview fallback); "auth" = session/account rejected. */
    readonly kind: 'network' | 'auth' | 'api',
    readonly status: number | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** The API base: Mantel's production origin, or a loopback mock for development (VELA_MANTEL_API_URL). */
export function mantelBaseUrl(): string {
  const override = process.env.VELA_MANTEL_API_URL?.trim();
  if (!override) return MANTEL_API_URL;
  try {
    const url = new URL(override);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.origin;
  } catch {
    /* fall through */
  }
  return MANTEL_API_URL;
}

type Method = 'GET' | 'POST' | 'DELETE';

async function request(method: Method, route: string, options: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': `Tarnel/${app.getVersion()}` };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await net.fetch(`${mantelBaseUrl()}${route}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new MantelError('Mantel is not reachable right now.', 'network');
  }
  const text = await response.text().catch(() => '');
  if (text.length > MAX_BODY_BYTES) throw new MantelError('Mantel sent an unexpectedly large answer.', 'api', response.status);
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new MantelError('Mantel sent an answer Tarnel does not understand.', 'network', response.status);
    }
  }
  return { status: response.status, body };
}

function fail(status: number, body: unknown): never {
  const { code, message } = parseApiError(body);
  const kind = status === 401 && (code === null || code === 'unauthorized') ? 'auth' : 'api';
  throw new MantelError(describeApiError(status, code, message), kind, status, code);
}

function unexpected(status: number): never {
  throw new MantelError('Mantel sent an answer in an unexpected format.', 'api', status);
}

export const mantel = {
  async login(accountNumber: string, totp: string | null = null): Promise<{ token: string; paidUntil: string }> {
    const { status, body } = await request('POST', '/api/v1/auth/login', { body: { code: accountNumber, totp } });
    if (status !== 200) fail(status, body);
    return parseLogin(body) ?? unexpected(status);
  },

  async logout(token: string): Promise<void> {
    await request('POST', '/api/v1/auth/logout', { token }).catch(() => undefined);
  },

  async account(token: string): Promise<{ paidUntil: string }> {
    const { status, body } = await request('GET', '/api/v1/account', { token });
    if (status !== 200) fail(status, body);
    return parseAccount(body) ?? unexpected(status);
  },

  async nodes(token: string): Promise<VpnServer[]> {
    const { status, body } = await request('GET', '/api/v1/nodes', { token });
    if (status !== 200) fail(status, body);
    return parseNodes(body) ?? unexpected(status);
  },

  /** Null when the server side has no proxy support yet (404), like the Mantel app treats it. */
  async proxies(token: string): Promise<MantelProxy[] | null> {
    const { status, body } = await request('GET', '/api/v1/proxies', { token });
    if (status === 404) return null;
    if (status !== 200) fail(status, body);
    return parseProxyList(body) ?? unexpected(status);
  },

  async createProxy(token: string, nodeId: string): Promise<{ proxy: MantelProxy; password: string }> {
    const { status, body } = await request('POST', '/api/v1/proxies', {
      token,
      body: { name: 'Tarnel', nodeId, protocol: 'http', exit: 'direct' },
    });
    if (status !== 201 && status !== 200) fail(status, body);
    return parseProxyWithPassword(body) ?? unexpected(status);
  },

  async deleteProxy(token: string, id: string): Promise<void> {
    await request('DELETE', `/api/v1/proxies/${encodeURIComponent(id)}`, { token }).catch(() => undefined);
  },
};
