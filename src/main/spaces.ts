import { session as electronSession, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
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

const sessions = new Map<SpaceId, Session>();
/** Latest setProxy result per created session. */
const proxyReady = new Map<SpaceId, Promise<void>>();
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
function applyProxy(id: SpaceId, ses: Session, space: Space): void {
  const direct = !space.proxy || /^direct:\/\//i.test(space.proxy);
  const pending = ses.setProxy(direct ? { mode: 'direct' } : { proxyRules: space.proxy }).then(
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
  const space: Space = { id, name: cleanName(input?.name), color: cleanColor(input?.color), ephemeral: false, proxy: cleanProxy(input?.proxy), fingerprint: cleanFingerprint(input?.fingerprint, 'standard'), createdAt: Date.now() };
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
  await Promise.allSettled([ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache()]);
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

export function getSpaceSession(id: SpaceId): Session {
  const existing = sessions.get(id);
  if (existing) return existing;
  const space = getSpace(id);
  if (!space) throw new Error(`Unknown space: ${id}`);
  const ses = electronSession.fromPartition(partitionFor(space), { cache: true });
  sessions.set(id, ses);
  applyProxy(id, ses, space);
  for (const hook of hooks) runHook(hook, ses, space);
  return ses;
}

export function onSessionCreated(hook: SessionHook): void {
  hooks.push(hook);
  for (const [id, ses] of sessions) {
    const space = getSpace(id);
    if (space) runHook(hook, ses, space);
  }
}

export function onSpacesChanged(cb: () => void): void {
  changeListeners.add(cb);
}

export async function disposeEphemeralSpaces(): Promise<void> {
  const targets: Session[] = [];
  for (const space of ephemeral) {
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
export async function whenSessionReady(id: SpaceId): Promise<void> {
  getSpaceSession(id);
  await readyGates.get(id);
  for (;;) {
    const pending = proxyReady.get(id);
    if (!pending) return;
    await pending;
    if (proxyReady.get(id) === pending) return;
  }
}

export function onSessionRemoved(hook: (session: Session) => void): void {
  removedHooks.push(hook);
}

function forgetSession(id: SpaceId): void {
  sessions.delete(id);
  proxyReady.delete(id);
  readyGates.delete(id);
}

/** Extra work a new session must finish before pages load (e.g. extensions). Must never reject. */
const readyGates = new Map<SpaceId, Promise<void>>();

/** Delay whenSessionReady() for this Space until `gate` settles. Call from an onSessionCreated hook. */
export function gateSessionReady(id: SpaceId, gate: Promise<void>): void {
  readyGates.set(id, gate.catch(() => undefined));
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
