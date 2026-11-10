import { app, safeStorage } from 'electron';
import { VPN_IPC, normalizeAccountNumber, normalizeTotp, type VpnConnection, type VpnResult, type VpnServer, type VpnState } from '../../shared/vpn';
import { normalizeCountry, pickServer } from '../../shared/vpn-route';
import { getActiveSpaceId, getSpace, refreshRoutedProxies, routedCountryOf, setRouteProxyProvider, updateSpace } from '../spaces';
import { getBrowserState, getTabVpn, setTabVpn } from '../tabs';
import { createStore, type JsonStore } from '../store';
import { sendToChrome } from '../window';
import { MantelError, mantel } from './mantel';

/**
 * MantelVPN in Vela. A browser cannot bring up a system WireGuard tunnel, so "connect" routes the
 * active Space through an account-scoped Mantel HTTP proxy on the chosen location (Mantel's
 * "server proxies"), reusing the Space proxy plumbing (fail-closed). Proxy authentication is
 * answered from main via app "login". Secrets (account number, proxy passwords) are kept with
 * safeStorage only; the session token stays in memory.
 */

interface StoredProxy {
  id: string;
  nodeId: string;
  /** host:port, IPv6 bracketed. */
  address: string;
  username: string;
  /** safeStorage, base64. */
  password: string;
}

interface StoredRoute extends VpnConnection {
  /** The Space's proxy before connecting, restored on disconnect. */
  previousProxy: string;
}

interface VpnFile {
  /** safeStorage-protected account number (base64), never plain text. */
  account: string | null;
  tail: string | null;
  proxies: StoredProxy[];
  route: StoredRoute | null;
  /** Per-tab routing: country code -> id of the stored proxy its tabs use. */
  countries: Record<string, string>;
}

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

let store: JsonStore<VpnFile> | null = null;
let token: string | null = null;
let paidUntil: string | null = null;
let servers: VpnServer[] = [];
let mode: VpnState['mode'] = 'signed-out';
let notice: string | null = null;
/** Account number held only for this run when safeStorage is unavailable. */
let volatileAccount: string | null = null;
/** Account number waiting for its two-factor code (first sign-in); memory only. */
let pendingAccount: string | null = null;
/** The stored account needs a fresh two-factor code before the session can be renewed. */
let totpNeeded = false;

const isTotpError = (error: unknown): boolean =>
  error instanceof MantelError && (error.code === 'totp_required' || error.code === 'totp_invalid');

function requireStore(): JsonStore<VpnFile> {
  store ??= createStore<VpnFile>('vpn', { account: null, tail: null, proxies: [], route: null, countries: {} });
  return store;
}

function encrypt(secret: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(secret).toString('base64');
}

function decrypt(sealed: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(sealed, 'base64'));
  } catch {
    return null;
  }
}

function storedAccount(): string | null {
  const sealed = requireStore().get().account;
  return sealed ? decrypt(sealed) : volatileAccount;
}

function snapshot(): VpnState {
  const file = requireStore().get();
  const route = file.route;
  return {
    mode,
    accountTail: mode === 'signed-out' ? null : file.tail,
    paidUntil,
    servers,
    connection: route ? { serverId: route.serverId, spaceId: route.spaceId, proxy: route.proxy, connectedAt: route.connectedAt } : null,
    notice,
    totpRequired: pendingAccount !== null || totpNeeded,
  };
}

function emit(): VpnState {
  const state = snapshot();
  sendToChrome(VPN_IPC.changed, state);
  return state;
}

function failure(error: unknown): VpnResult {
  const message = error instanceof MantelError ? error.message : 'Something went wrong. Try again.';
  return { ok: false, error: message, state: emit() };
}

function bracket(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

/** Signs in with the stored number; on an unreachable API falls back to preview data. */
async function signIn(accountNumber: string, totp: string | null = null): Promise<void> {
  try {
    const session = await mantel.login(accountNumber, totp);
    token = session.token;
    paidUntil = session.paidUntil;
    servers = await mantel.nodes(token);
    mode = 'live';
    notice = null;
  } catch (error) {
    if (error instanceof MantelError && error.kind === 'network') {
      token = null;
      mode = 'preview';
      servers = [];
      notice = 'Mantel is not reachable. Showing preview data.';
      return;
    }
    throw error;
  }
}

async function withSession<T>(task: (session: string) => Promise<T>): Promise<T> {
  const accountNumber = storedAccount();
  if (!accountNumber) throw new MantelError('Sign in with your Mantel account number first.', 'auth');
  if (!token && totpNeeded) throw new MantelError('Enter a code from your authenticator app to continue.', 'auth');
  if (!token) await signIn(accountNumber);
  if (!token) throw new MantelError('Mantel is not reachable right now.', 'network');
  try {
    return await task(token);
  } catch (error) {
    if (!(error instanceof MantelError) || error.kind !== 'auth') throw error;
    token = null;
    try {
      await signIn(accountNumber);
    } catch (renewError) {
      if (!isTotpError(renewError)) throw renewError;
      totpNeeded = true;
      emit();
      throw new MantelError('Your Mantel session ended. Enter a code from your authenticator app to continue.', 'auth');
    }
    if (!token) throw error;
    return task(token);
  }
}

/** Restores the Space's previous proxy, unless the user changed it meanwhile. */
function restoreRoute(): void {
  const file = requireStore().get();
  const route = file.route;
  if (!route) return;
  const space = getSpace(route.spaceId);
  if (space && space.proxy === `http://${route.proxy}`) {
    try {
      updateSpace(route.spaceId, { proxy: route.previousProxy });
    } catch {
      /* space vanished or rejected: nothing left to restore */
    }
  }
  requireStore().update((current) => ({ ...current, route: null }));
}

async function credentialFor(session: string, nodeId: string): Promise<StoredProxy> {
  const remote = await mantel.proxies(session);
  if (remote === null) throw new MantelError('Mantel proxies are not available for this account yet.', 'api');
  const known = requireStore().get().proxies;
  const usable = known.find(
    (entry) =>
      entry.nodeId === nodeId &&
      remote.some((proxy) => proxy.id === entry.id && proxy.protocol === 'http' && proxy.enabled && proxy.status !== 'unavailable'),
  );
  if (usable) return usable;
  const created = await mantel.createProxy(session, nodeId);
  const sealed = encrypt(created.password);
  if (!sealed) throw new MantelError('Secure storage is unavailable on this system, so Vela cannot keep the proxy password.', 'api');
  const stored: StoredProxy = {
    id: created.proxy.id,
    nodeId,
    address: `${bracket(created.proxy.host)}:${created.proxy.port}`,
    username: created.proxy.username,
    password: sealed,
  };
  const stale = known.filter((entry) => entry.nodeId === nodeId);
  for (const entry of stale) void mantel.deleteProxy(session, entry.id);
  requireStore().update((current) => ({ ...current, proxies: [...current.proxies.filter((entry) => entry.nodeId !== nodeId), stored] }));
  return stored;
}

async function connect(serverId: unknown): Promise<VpnResult> {
  if (typeof serverId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(serverId)) throw new TypeError('Invalid server');
  if (mode !== 'live') return { ok: false, error: 'Connecting needs a live Mantel session.', state: emit() };
  try {
    const credential = await withSession((session) => credentialFor(session, serverId));
    restoreRoute();
    const spaceId = getActiveSpaceId();
    const space = getSpace(spaceId);
    if (!space) throw new MantelError('No active Space.', 'api');
    const route: StoredRoute = { serverId, spaceId, proxy: credential.address, connectedAt: Date.now(), previousProxy: space.proxy };
    requireStore().update((current) => ({ ...current, route }));
    updateSpace(spaceId, { proxy: `http://${credential.address}` });
    return { ok: true, state: emit() };
  } catch (error) {
    return failure(error);
  }
}

function countryMap(): Record<string, string> {
  const countries = requireStore().get().countries;
  return countries && typeof countries === 'object' ? countries : {};
}

/** Proxy rules for a routed country: its stored Mantel proxy, or null (blackhole) when there is none. */
function countryProxy(country: string): string | null {
  const file = requireStore().get();
  if (!file.account && !volatileAccount) return null;
  const proxyId = countryMap()[country];
  const proxy = proxyId ? file.proxies.find((entry) => entry.id === proxyId) : undefined;
  return proxy ? `http://${proxy.address}` : null;
}

/** Routes one tab through a country (creating or reusing that location's proxy), or back to its Space (null). */
async function routeTab(rawTabId: unknown, rawCountry: unknown): Promise<VpnResult> {
  if (typeof rawTabId !== 'number' || !Number.isInteger(rawTabId)) throw new TypeError('Invalid tab');
  if (rawCountry === null) {
    setTabVpn(rawTabId, null);
    return { ok: true, state: emit() };
  }
  const country = normalizeCountry(rawCountry);
  if (!country) throw new TypeError('Invalid country');
  if (mode !== 'live') return { ok: false, error: 'Sign in to MantelVPN to route a tab.', state: emit() };
  const server = pickServer(servers, country);
  if (!server) return { ok: false, error: 'No server in this country is available right now.', state: emit() };
  try {
    const credential = await withSession((session) => credentialFor(session, server.id));
    requireStore().update((current) => ({ ...current, countries: { ...countryMap(), [country]: credential.id } }));
    refreshRoutedProxies();
    if (getTabVpn(rawTabId) !== country) setTabVpn(rawTabId, country);
    return { ok: true, state: emit() };
  } catch (error) {
    return failure(error);
  }
}

async function login(raw: unknown): Promise<VpnResult> {
  const accountNumber = typeof raw === 'string' ? normalizeAccountNumber(raw) : null;
  if (!accountNumber) return { ok: false, error: 'An account number has exactly 16 digits.', state: snapshot() };
  try {
    token = null;
    pendingAccount = null;
    totpNeeded = false;
    try {
      await signIn(accountNumber);
    } catch (error) {
      if (!isTotpError(error)) throw error;
      pendingAccount = accountNumber;
      return failure(error);
    }
    return finishLogin(accountNumber);
  } catch (error) {
    mode = storedAccount() ? mode : 'signed-out';
    return failure(error);
  }
}

function finishLogin(accountNumber: string): VpnResult {
  pendingAccount = null;
  totpNeeded = false;
  const sealed = encrypt(accountNumber);
  volatileAccount = sealed ? null : accountNumber;
  if (!sealed) notice = 'Secure storage is unavailable, so you will need to sign in again after a restart.';
  requireStore().update((current) => ({ ...current, account: sealed, tail: accountNumber.slice(-4) }));
  return { ok: true, state: emit() };
}

/** Second sign-in step: the pending (or stored) account number plus a code from the authenticator app. */
async function verifyTotp(raw: unknown): Promise<VpnResult> {
  const code = normalizeTotp(raw);
  if (!code) return { ok: false, error: 'Enter the 6-digit code from your authenticator app.', state: snapshot() };
  const accountNumber = pendingAccount ?? (totpNeeded ? storedAccount() : null);
  if (!accountNumber) return { ok: false, error: 'Sign in with your Mantel account number first.', state: snapshot() };
  try {
    token = null;
    await signIn(accountNumber, code);
    if (!token) return failure(new MantelError('Mantel is not reachable right now.', 'network'));
    return finishLogin(accountNumber);
  } catch (error) {
    return failure(error);
  }
}

async function logout(): Promise<VpnState> {
  restoreRoute();
  const session = token;
  const proxies = requireStore().get().proxies;
  if (session) {
    for (const entry of proxies) await mantel.deleteProxy(session, entry.id);
    await mantel.logout(session);
  }
  token = null;
  paidUntil = null;
  servers = [];
  mode = 'signed-out';
  notice = null;
  volatileAccount = null;
  pendingAccount = null;
  totpNeeded = false;
  requireStore().set({ account: null, tail: null, proxies: [], route: null, countries: {} });
  refreshRoutedProxies();
  return emit();
}

async function refresh(): Promise<VpnState> {
  const accountNumber = storedAccount();
  if (!accountNumber) {
    mode = 'signed-out';
    return emit();
  }
  try {
    if (!token) await signIn(accountNumber);
    else {
      paidUntil = (await withSession(mantel.account)).paidUntil;
      servers = await withSession(mantel.nodes);
      mode = 'live';
      notice = null;
    }
  } catch (error) {
    notice = error instanceof MantelError ? error.message : 'Something went wrong. Try again.';
    if (error instanceof MantelError && error.kind === 'network') mode = 'preview';
  }
  return emit();
}

/** Answers proxy auth challenges for the Mantel proxy currently in use, and nothing else. */
function answerProxyAuth(): void {
  app.on('login', (event, webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return;
    const file = requireStore().get();
    const address = `${bracket(authInfo.host)}:${authInfo.port}`;
    const country = webContents && !webContents.isDestroyed() ? routedCountryOf(webContents.session) : null;
    const inUse = new Set([...Object.values(countryMap())]);
    const credential = country
      ? file.proxies.find((entry) => entry.id === countryMap()[country] && entry.address === address)
      : file.proxies.find((entry) => entry.address === address && (file.route?.proxy === address || inUse.has(entry.id)));
    const password = credential ? decrypt(credential.password) : null;
    if (!credential || !password) return;
    event.preventDefault();
    callback(credential.username, password);
  });
}

export function registerVpnIpc(handle: ChromeHandler): void {
  setRouteProxyProvider(countryProxy);
  refreshRoutedProxies();
  restoreRoute();
  if (requireStore().get().account) mode = 'preview';
  answerProxyAuth();
  handle(VPN_IPC.state, () => snapshot());
  handle(VPN_IPC.refresh, () => refresh());
  handle(VPN_IPC.login, (raw) => login(raw));
  handle(VPN_IPC.verifyTotp, (raw) => verifyTotp(raw));
  handle(VPN_IPC.logout, () => logout());
  handle(VPN_IPC.connect, (serverId) => connect(serverId));
  handle(VPN_IPC.routeTab, (tabId, country) => routeTab(tabId, country));
  handle(VPN_IPC.disconnect, () => {
    restoreRoute();
    return emit();
  });
}

/** Panic: drop the Space route and every per-tab route (keeps the account signed in). */
export function disconnectAll(): void {
  restoreRoute();
  for (const tab of getBrowserState().tabs) if (tab.vpn) setTabVpn(tab.id, null);
  emit();
}
