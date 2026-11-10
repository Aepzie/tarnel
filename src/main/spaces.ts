import { app, session as electronSession, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanLanguage, cleanTimezone } from '../shared/fingerprint';
import { normalizeCountry, routeKey, routedPartition } from '../shared/vpn-route';
import { FINGERPRINT_LEVELS, SPACE_COLORS, type FingerprintLevel, type Space, type SpaceColor, type SpaceId, type SpaceInput } from '../shared/types';
import { applyPrivacy } from './privacy';
import { createStore, type JsonStore } from './store';

interface SpacesFile {
  spaces: Space[];
  activeSpaceId: SpaceId;
}

type SessionHook = (session: Session, space: Space) => void;

const NAME_MAX = 32;
const PROXY_MAX = 200;
const SUPPORTED_PROXY_SCHEME = /^(https?|socks4|socks5|direct):\/\//i;

let store: JsonStore<SpacesFile> | null = null;
/** Ephemeral spaces live only in memory and are never written to disk. */
let ephemeral: Space[] = [];
let activeSpaceId: SpaceId = '';

/** Created sessions by session key: the Space id, or `<space>@vpn-<cc>` for a VPN-routed partition. */
const sessions = new Map<string, Session>();
/** Routed sessions: session key -> its Space and country. */
const routed = new Map<string, { spaceId: SpaceId; country: string }>();
/** Latest setProxy result per created session (by session key). */
const proxyReady = new Map<string, Promise<void>>();
/** Proxy rules for a VPN country, or null when it cannot be routed (the session is then blackholed). */
let routeProxy: (country: string) => string | null = () => null;
/** While hooks run for a routed session, gateSessionReady(space.id) applies to that session. */
let hookKey: { spaceId: SpaceId; key: string } | null = null;
const removedHooks: ((session: Session) => void)[] = [];
const hooks: SessionHook[] = [];
const changeListeners = new Set<() => void>();

function requireStore(): JsonStore<SpacesFile> {
  if (!store) throw new Error('initSpaces() has not been called');
  return store;
}

function allSpaces(): Space[] {
  return [...requireStore().get().spaces, ...ephemeral];
}

function newId(): SpaceId {
  const taken = new Set(allSpaces().map((s) => s.id));
  let id = randomUUID().slice(0, 8);
  while (taken.has(id)) id = randomUUID().slice(0, 8);
  return id;
}

function partitionFor(space: Space): string {
  return space.ephemeral ? `space-${space.id}` : `persist:space-${space.id}`;
}

function cleanName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim().slice(0, NAME_MAX).trim() : '';
  if (!trimmed) throw new Error('Space name must not be empty');
  return trimmed;
}

function cleanColor(color: unknown): SpaceColor {
  if (!SPACE_COLORS.includes(color as SpaceColor)) throw new Error(`Invalid space color: ${String(color)}`);
  return color as SpaceColor;
}

function cleanFingerprint(level: unknown, fallback: FingerprintLevel): FingerprintLevel {
  if (level === undefined || level === null) return fallback;
  if (!FINGERPRINT_LEVELS.includes(level as FingerprintLevel)) throw new Error('Invalid fingerprint level');
  return level as FingerprintLevel;
}

/**
 * Accepts "" (direct), "direct://", "<scheme>://host:port" with scheme http/https/socks4/socks5,
 * or bare "host:port" (Chromium treats it as http).
 */
function cleanProxy(proxy: unknown): string {
  if (proxy === undefined || proxy === null) return '';
  if (typeof proxy !== 'string') throw new Error('Invalid proxy');
  const value = proxy.trim();
  if (!value) return '';
  if (value.length > PROXY_MAX) throw new Error('Proxy string too long');
  if (/[\s;,]/.test(value)) throw new Error('Invalid proxy');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    if (!SUPPORTED_PROXY_SCHEME.test(value)) throw new Error('Unsupported proxy scheme');
    return value;
  }
  if (!/^([\w.-]+|\[[0-9a-f:.]+\]):\d{1,5}$/i.test(value)) throw new Error('Invalid proxy');
  return value;
}

/** Port 9 ("discard") on loopback: connections fail immediately, nothing leaves the machine. */
const BLACKHOLE_PROXY = 'http://127.0.0.1:9';

/**
 * Applies the space proxy and records the pending result. A failure is NOT swallowed: the
 * session stays "not ready" (rejected) until a later update succeeds, so callers awaiting
 * whenSessionReady() never load pages through an unintended direct connection.
 */
function applyProxy(id: string, ses: Session, space: Space): void {
  applyRules(id, ses, space.proxy);
}

function applyRules(id: string, ses: Session, rules: string): void {
  const direct = !rules || /^direct:\/\//i.test(rules);
  const pending = ses.setProxy(direct ? { mode: 'direct' } : { proxyRules: rules }).then(
    () => undefined,
    async (err: unknown) => {
      // Fail CLOSED: route everything to an unroutable proxy so in-page navigations (links,
      // location.href, the error page's "Try again") can never fall back to a direct connection.
      await ses.setProxy({ proxyRules: BLACKHOLE_PROXY }).catch(() => undefined);
      throw new Error(`Failed to apply proxy for space ${id}: ${err instanceof Error ? err.message : String(err)}`);
    },
  );
  pending.catch(() => undefined); // avoid unhandled rejection; consumers see it via whenSessionReady
  proxyReady.set(id, pending);
}

function emitChanged(): void {
  for (const cb of changeListeners) {
    try {
      cb();
    } catch {
      /* ignore listener errors */
    }
  }
}

function runHook(hook: SessionHook, ses: Session, space: Space): void {
  try {
    hook(ses, space);
  } catch {
    /* one failing hook (adblock, protocol, …) must not prevent the others */
  }
}

/** The on-disk active id must reference a persisted space. */
function persistedActiveId(spaces: Space[]): SpaceId {
  if (spaces.some((s) => s.id === activeSpaceId)) return activeSpaceId;
  return spaces[0]?.id ?? '';
}

function isStoredSpace(s: unknown): s is Space {
  if (!s || typeof s !== 'object') return false;
  const c = s as Partial<Space>;
  return typeof c.id === 'string' && typeof c.name === 'string' && SPACE_COLORS.includes(c.color as SpaceColor) && !c.ephemeral;
}

export function initSpaces(): void {
  if (store) return;
  store = createStore<SpacesFile>('spaces', { spaces: [], activeSpaceId: '' });
  const file = store.get();
  const spaces: Space[] = (Array.isArray(file.spaces) ? file.spaces : []).filter(isStoredSpace).map((s) => ({
    ...s,
    ephemeral: false,
    proxy: typeof s.proxy === 'string' ? s.proxy : '',
    fingerprint: FINGERPRINT_LEVELS.includes(s.fingerprint) ? s.fingerprint : 'standard',
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
  }));
  if (spaces.length === 0) {
    spaces.push({ id: randomUUID().slice(0, 8), name: 'Personal', color: 'blue', ephemeral: false, proxy: '', fingerprint: 'standard', createdAt: Date.now() });
  }
  activeSpaceId = spaces.some((s) => s.id === file.activeSpaceId) ? file.activeSpaceId : spaces[0]!.id;
  store.set({ spaces, activeSpaceId });
  onSessionCreated(applyPrivacy);
}

export function listSpaces(): Space[] {
  return allSpaces();
}

export function getSpace(id: SpaceId): Space | undefined {
  return allSpaces().find((s) => s.id === id);
}

export function createSpace(input: SpaceInput): Space {
  const space: Space = {
    id: newId(),
    name: cleanName(input?.name),
    color: cleanColor(input?.color),
    ephemeral: input?.ephemeral === true,
    proxy: cleanProxy(input?.proxy),
    fingerprint: cleanFingerprint(input?.fingerprint, input?.ephemeral === true ? 'strict' : 'standard'),
    timezone: cleanTimezone(input?.timezone),
    language: cleanLanguage(input?.language),
    createdAt: Date.now(),
  };
  if (space.ephemeral) ephemeral = [...ephemeral, space];
  else requireStore().update((f) => ({ ...f, spaces: [...f.spaces, space] }));
  emitChanged();
  return space;
}

/** Creates a persistent space with a fixed id (a space that arrived through sync). */
export function importSpace(id: SpaceId, input: Omit<SpaceInput, 'ephemeral'>): Space {
  if (!/^[\w-]{1,64}$/.test(id) || getSpace(id)) throw new Error(`Invalid space id: ${id}`);
  const space: Space = { id, name: cleanName(input?.name), color: cleanColor(input?.color), ephemeral: false, proxy: cleanProxy(input?.proxy), fingerprint: cleanFingerprint(input?.fingerprint, 'standard'), timezone: cleanTimezone(input?.timezone), language: cleanLanguage(input?.language), createdAt: Date.now() };
  requireStore().update((f) => ({ ...f, spaces: [...f.spaces, space] }));
  emitChanged();
  return space;
}

export function updateSpace(id: SpaceId, patch: Partial<SpaceInput>): Space {
  const current = getSpace(id);
  if (!current) throw new Error(`Unknown space: ${id}`);
  const next: Space = {
    ...current,
    name: patch?.name !== undefined ? cleanName(patch.name) : current.name,
    color: patch?.color !== undefined ? cleanColor(patch.color) : current.color,
    proxy: patch?.proxy !== undefined ? cleanProxy(patch.proxy) : current.proxy,
    fingerprint: cleanFingerprint(patch?.fingerprint, current.fingerprint),
    timezone: cleanTimezone(patch?.timezone, current.timezone ?? ''),
    language: cleanLanguage(patch?.language, current.language ?? ''),
  };
  if (next.ephemeral) ephemeral = ephemeral.map((s) => (s.id === id ? next : s));
  else requireStore().update((f) => ({ ...f, spaces: f.spaces.map((s) => (s.id === id ? next : s)) }));
  const ses = sessions.get(id);
  if (ses && next.proxy !== current.proxy) applyProxy(id, ses, next);
  emitChanged();
  return next;
}

export async function removeSpace(id: SpaceId): Promise<void> {
  const space = getSpace(id);
  if (!space) return;
  if (allSpaces().length <= 1) throw new Error('Cannot remove the last space');

  if (space.ephemeral) ephemeral = ephemeral.filter((s) => s.id !== id);
  if (activeSpaceId === id) activeSpaceId = allSpaces().find((s) => s.id !== id)!.id;
  requireStore().update((f) => {
    const spaces = f.spaces.filter((s) => s.id !== id);
    return { spaces, activeSpaceId: persistedActiveId(spaces) };
  });
  emitChanged();

  // Wipe the partition even if it was never opened this run (persistent data from earlier runs).
  const created = sessions.get(id);
  const ses = created ?? electronSession.fromPartition(partitionFor(space), { cache: true });
  forgetSession(id);
  if (created) emitSessionRemoved(created);
  const targets = [ses, ...dropRoutedSessions(space)];
  await Promise.allSettled(targets.flatMap((target) => [target.clearStorageData(), target.clearCache(), target.clearAuthCache()]));
}

export async function clearSpaceData(id: SpaceId): Promise<void> {
  if (!getSpace(id)) throw new Error(`Unknown space: ${id}`);
  const ses = getSpaceSession(id);
  await Promise.all([ses.clearStorageData(), ses.clearCache(), ses.clearHostResolverCache()]);
}

export function getActiveSpaceId(): SpaceId {
  return activeSpaceId;
}

export function setActiveSpaceId(id: SpaceId): void {
  if (id === activeSpaceId || !getSpace(id)) return;
  activeSpaceId = id;
  requireStore().update((f) => ({ ...f, activeSpaceId: persistedActiveId(f.spaces) }));
  emitChanged();
}

/**
 * The Space's session, or with `country` its MantelVPN partition for that country: the same Space
 * protections (every onSessionCreated hook runs), separate storage, the proxy from the VPN route
 * provider, or the blackhole when the country cannot be routed (fail closed).
 */
export function getSpaceSession(id: SpaceId, country: string | null = null): Session {
  const key = routeKey(id, country);
  const existing = sessions.get(key);
  if (existing) return existing;
  const space = getSpace(id);
  if (!space) throw new Error(`Unknown space: ${id}`);
  if (country !== null && normalizeCountry(country) !== country) throw new Error(`Invalid country: ${country}`);
  const partition = country ? routedPartition(space.id, space.ephemeral, country) : partitionFor(space);
  const ses = electronSession.fromPartition(partition, { cache: true });
  sessions.set(key, ses);
  if (country) {
    routed.set(key, { spaceId: id, country });
    applyRules(key, ses, routeProxy(country) ?? BLACKHOLE_PROXY);
  } else applyProxy(key, ses, space);
  runHooksFor(key, ses, space, hooks);
  return ses;
}

function runHooksFor(key: string, ses: Session, space: Space, list: SessionHook[]): void {
  hookKey = { spaceId: space.id, key };
  try {
    for (const hook of list) runHook(hook, ses, space);
  } finally {
    hookKey = null;
  }
}

/** Where routed sessions get their proxy rules from (the VPN module). */
export function setRouteProxyProvider(provider: (country: string) => string | null): void {
  routeProxy = provider;
}

/** Re-applies the proxy of every open routed session (after a VPN proxy was created or removed). */
export function refreshRoutedProxies(): void {
  for (const [key, route] of routed) {
    const ses = sessions.get(key);
    if (ses) applyRules(key, ses, routeProxy(route.country) ?? BLACKHOLE_PROXY);
  }
}

/** The VPN country a session routes through, if it is a routed partition. */
export function routedCountryOf(ses: Session): string | null {
  for (const [key, route] of routed) if (sessions.get(key) === ses) return route.country;
  return null;
}

/** Forgets the Space's routed sessions, including partitions earlier runs left on disk. */
function dropRoutedSessions(space: Space): Session[] {
  const found = new Set<Session>();
  for (const [key, route] of [...routed]) {
    if (route.spaceId !== space.id) continue;
    const ses = sessions.get(key);
    forgetSession(key);
    if (!ses) continue;
    emitSessionRemoved(ses);
    found.add(ses);
  }
  if (space.ephemeral) return [...found];
  try {
    const prefix = `space-${space.id}-vpn-`;
    for (const name of readdirSync(join(app.getPath('userData'), 'Partitions'))) {
      const country = name.startsWith(prefix) ? normalizeCountry(name.slice(prefix.length)) : null;
      if (country) found.add(electronSession.fromPartition(routedPartition(space.id, false, country), { cache: true }));
    }
  } catch {
    /* no partitions on disk */
  }
  return [...found];
}

export function onSessionCreated(hook: SessionHook): void {
  hooks.push(hook);
  for (const [key, ses] of sessions) {
    const space = getSpace(routed.get(key)?.spaceId ?? key);
    if (space) runHooksFor(key, ses, space, [hook]);
  }
}

export function onSpacesChanged(cb: () => void): void {
  changeListeners.add(cb);
}

export async function disposeEphemeralSpaces(): Promise<void> {
  const targets: Session[] = [];
  for (const space of ephemeral) {
    targets.push(...dropRoutedSessions(space));
    const ses = sessions.get(space.id);
    if (!ses) continue;
    targets.push(ses);
    forgetSession(space.id);
    emitSessionRemoved(ses);
  }
  await Promise.allSettled(targets.flatMap((ses) => [ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache()]));
}

/**
 * Resolves once the space's session exists and its proxy configuration has been applied
 * (re-awaits if the proxy changed meanwhile). Rejects if the latest setProxy failed.
 */
export async function whenSessionReady(id: SpaceId, country: string | null = null): Promise<void> {
  getSpaceSession(id, country);
  const key = routeKey(id, country);
  await readyGates.get(key);
  for (;;) {
    const pending = proxyReady.get(key);
    if (!pending) return;
    await pending;
    if (proxyReady.get(key) === pending) return;
  }
}

export function onSessionRemoved(hook: (session: Session) => void): void {
  removedHooks.push(hook);
}

function forgetSession(key: string): void {
  sessions.delete(key);
  routed.delete(key);
  proxyReady.delete(key);
  readyGates.delete(key);
}

/** Extra work a new session must finish before pages load (e.g. extensions). Must never reject. */
const readyGates = new Map<string, Promise<void>>();

/** Delay whenSessionReady() for this Space until `gate` settles. Call from an onSessionCreated hook. */
export function gateSessionReady(id: SpaceId, gate: Promise<void>): void {
  const key = hookKey && hookKey.spaceId === id ? hookKey.key : id;
  readyGates.set(key, gate.catch(() => undefined));
}

function emitSessionRemoved(ses: Session): void {
  for (const hook of removedHooks) {
    try {
      hook(ses);
    } catch {
      /* ignore hook errors */
    }
  }
}
