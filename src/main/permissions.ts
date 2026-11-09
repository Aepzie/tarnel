import type { Session, WebContents } from 'electron';
import type { PermissionPrompter, PermissionScope } from './privacy';
import { randomUUID } from 'node:crypto';
import { IPC } from '../shared/ipc';
import type { PermissionKind, PermissionRequest, SpaceId } from '../shared/types';
import { createStore, type JsonStore } from './store';
import { tabIdForWebContents } from './tabs';
import { sendToChrome } from './window';

export type { PermissionScope };

type MediaType = 'video' | 'audio';
type PersistedDecisions = Record<SpaceId, Record<string, boolean>>;

const PROMPT_TIMEOUT_MS = 60_000;

interface Pending {
  request: PermissionRequest;
  scope: PermissionScope;
  promise: Promise<boolean>;
  settle: (allow: boolean, remember: boolean) => void;
}

const pending = new Map<string, Pending>();
const pendingByKey = new Map<string, Pending>();
const sessionDecisions = new WeakMap<Session, Map<string, boolean>>();
let store: JsonStore<PersistedDecisions> | null = null;

function getStore(): JsonStore<PersistedDecisions> {
  store ??= createStore<PersistedDecisions>('permissions', {});
  return store;
}

/** Media is decided per device so "allow microphone" never silently grants the camera. */
function decisionKeys(origin: string, permission: PermissionKind, mediaTypes: MediaType[] | undefined): string[] {
  if (permission !== 'media') return [`${origin}|${permission}`];
  const types = mediaTypes && mediaTypes.length > 0 ? mediaTypes : (['video', 'audio'] as MediaType[]);
  return types.map((type) => `${origin}|media:${type}`);
}

function lookup(scope: PermissionScope, key: string): boolean | undefined {
  const inMemory = sessionDecisions.get(scope.session)?.get(key);
  if (inMemory !== undefined) return inMemory;
  if (scope.ephemeral) return undefined;
  return getStore().get()[scope.spaceId]?.[key];
}

/**
 * Remembered answer for a request, or undefined when the user must be asked.
 * Any blocked device blocks the whole request; all devices must be allowed to grant it.
 */
export function getRememberedDecision(
  scope: PermissionScope,
  origin: string,
  permission: PermissionKind,
  mediaTypes?: MediaType[],
): boolean | undefined {
  const answers = decisionKeys(origin, permission, mediaTypes).map((key) => lookup(scope, key));
  if (answers.includes(false)) return false;
  if (answers.every((answer) => answer === true)) return true;
  return undefined;
}

/** Sync check used by the permission check handler: true only for an explicit remembered grant. */
export function hasGrant(scope: PermissionScope, origin: string, permission: PermissionKind, mediaType?: string): boolean {
  if (permission === 'media' && (mediaType === 'video' || mediaType === 'audio')) {
    return getRememberedDecision(scope, origin, 'media', [mediaType]) === true;
  }
  if (permission === 'media') {
    return getRememberedDecision(scope, origin, 'media', ['video']) === true || getRememberedDecision(scope, origin, 'media', ['audio']) === true;
  }
  return getRememberedDecision(scope, origin, permission) === true;
}

function storeDecision(scope: PermissionScope, request: PermissionRequest, allow: boolean, remember: boolean): void {
  const keys = decisionKeys(request.origin, request.permission, request.mediaTypes);
  const decisions = sessionDecisions.get(scope.session) ?? new Map<string, boolean>();
  sessionDecisions.set(scope.session, decisions);
  for (const key of keys) decisions.set(key, allow);
  if (!remember || scope.ephemeral) return;
  getStore().update((current) => {
    const space = { ...(current[scope.spaceId] ?? {}) };
    for (const key of keys) space[key] = allow;
    return { ...current, [scope.spaceId]: space };
  });
}

/** Drop persisted decisions of a Space (e.g. when it is deleted or its data is cleared). */
export function forgetSpacePermissions(spaceId: SpaceId): void {
  if (!getStore().get()[spaceId]) return;
  getStore().update((current) => {
    const next = { ...current };
    delete next[spaceId];
    return next;
  });
}

function dedupeKey(scope: PermissionScope, request: Omit<PermissionRequest, 'id'>): string {
  const media = request.mediaTypes ? [...request.mediaTypes].sort().join(',') : '';
  return `${scope.spaceId}|${request.origin}|${request.permission}|${media}`;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Ask the user in the browser chrome. Resolves false on timeout, when the requesting page
 * navigates to another origin, or when its webContents goes away.
 */
export function requestPermission(
  request: Omit<PermissionRequest, 'id'>,
  webContents: WebContents,
  scope: PermissionScope,
): Promise<boolean> {
  const key = dedupeKey(scope, request);
  const shared = pendingByKey.get(key);
  if (shared) return shared.promise;

  const id = randomUUID();
  const full: PermissionRequest = { ...request, id, tabId: request.tabId ?? tabIdForWebContents(webContents.id) };

  let resolve: (allow: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });

  let finished = false;
  const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    if (!details.isMainFrame || details.isSameDocument) return;
    if (originOf(details.url) === full.origin) return;
    cancel();
  };
  const onDestroyed = (): void => cancel();
  const timer = setTimeout(() => cancel(), PROMPT_TIMEOUT_MS);

  const cleanup = (): void => {
    finished = true;
    clearTimeout(timer);
    pending.delete(id);
    pendingByKey.delete(key);
    if (!webContents.isDestroyed()) {
      webContents.removeListener('did-start-navigation', onNavigate);
      webContents.removeListener('destroyed', onDestroyed);
    }
  };

  function cancel(): void {
    if (finished) return;
    cleanup();
    sendToChrome(IPC.chromeEvents.permissionCancel, id);
    resolve(false);
  }

  const entry: Pending = {
    request: full,
    scope,
    promise,
    settle: (allow, remember) => {
      if (finished) return;
      cleanup();
      const live = !webContents.isDestroyed();
      storeDecision(scope, full, allow, remember);
      resolve(allow && live);
    },
  };

  pending.set(id, entry);
  pendingByKey.set(key, entry);
  webContents.on('did-start-navigation', onNavigate);
  webContents.once('destroyed', onDestroyed);
  sendToChrome(IPC.chromeEvents.permission, full);
  return promise;
}

/** Answer from the chrome UI. Unknown/expired ids are ignored. */
export function handlePermissionResponse(id: string, allow: boolean, remember: boolean): void {
  pending.get(id)?.settle(allow, remember);
}

export const chromePermissionPrompter: PermissionPrompter = {
  request: requestPermission,
  remembered: getRememberedDecision,
  granted: hasGrant,
};
