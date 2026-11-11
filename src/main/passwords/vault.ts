import type { SavedLogin } from '../../shared/passwords';
import type { AliasRef } from '../../shared/aliases';
import type { SpaceId } from '../../shared/types';
import { normaliseOrigin } from './origin';

/**
 * One Space's logins in memory. Passwords stay encrypted (base64 ciphertext from the Cipher) and
 * are only decrypted on demand: to fill a form the user picked, reveal/copy after a confirm, or
 * export. Pure: the Cipher is injected (Electron safeStorage in production, a fake in tests).
 */

export interface Cipher {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

export interface StoredLogin {
  id: string;
  origin: string;
  username: string;
  /** base64 of the Cipher output. Never the plain password. */
  password: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  alias?: AliasRef;
}

export interface VaultFile {
  version: 1;
  logins: StoredLogin[];
  /** Origins the user answered "Never for this site" for. */
  never: string[];
}

export const MAX_USERNAME = 1024;
export const MAX_PASSWORD = 4096;
export const MAX_LOGINS = 10_000;

export const emptyVault = (): VaultFile => ({ version: 1, logins: [], never: [] });

const isString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Repairs a parsed file: drops malformed entries instead of failing the whole vault. */
export function parseVault(raw: unknown): VaultFile {
  if (!raw || typeof raw !== 'object') return emptyVault();
  const record = raw as Record<string, unknown>;
  const logins: StoredLogin[] = [];
  for (const entry of Array.isArray(record.logins) ? record.logins : []) {
    if (!entry || typeof entry !== 'object') continue;
    const login = entry as Record<string, unknown>;
    if (!isString(login.id, 64) || !isString(login.origin, 4096) || !isString(login.username, MAX_USERNAME) || !isString(login.password, 65_536)) continue;
    if (normaliseOrigin(login.origin) !== login.origin || !isTime(login.createdAt)) continue;
    logins.push({
      id: login.id,
      origin: login.origin,
      username: login.username,
      password: login.password,
      createdAt: login.createdAt,
      updatedAt: isTime(login.updatedAt) ? login.updatedAt : login.createdAt,
      lastUsedAt: isTime(login.lastUsedAt) ? login.lastUsedAt : null,
      ...parseAliasRef(login.alias),
    });
  }
  const never = (Array.isArray(record.never) ? record.never : []).filter((origin): origin is string => typeof origin === 'string' && normaliseOrigin(origin) === origin);
  return { version: 1, logins: logins.slice(0, MAX_LOGINS), never: [...new Set(never)] };
}

function parseAliasRef(raw: unknown): { alias?: AliasRef } {
  if (!raw || typeof raw !== 'object') return {};
  const { provider, id, email } = raw as Record<string, unknown>;
  if ((provider !== 'simplelogin' && provider !== 'addy') || !isString(id, 64) || !isString(email, 320) || !email.includes('@')) return {};
  return { alias: { provider, id, email } };
}

export function toSavedLogin(spaceId: SpaceId, login: StoredLogin): SavedLogin {
  return { id: login.id, spaceId, origin: login.origin, username: login.username, createdAt: login.createdAt, lastUsedAt: login.lastUsedAt, ...(login.alias ? { alias: login.alias } : {}) };
}

/** Logins of exactly this origin, most recently used first. */
export function loginsFor(vault: VaultFile, origin: string): StoredLogin[] {
  return vault.logins
    .filter((login) => login.origin === origin)
    .sort((a, b) => (b.lastUsedAt ?? b.updatedAt) - (a.lastUsedAt ?? a.updatedAt));
}

export function findLogin(vault: VaultFile, origin: string, username: string): StoredLogin | undefined {
  return vault.logins.find((login) => login.origin === origin && login.username === username);
}

export type UpsertResult = 'added' | 'updated' | 'unchanged';

/** What saving this login would do, without saving it (drives "Save" vs "Update" prompts). */
export function classify(vault: VaultFile, cipher: Cipher, origin: string, username: string, password: string): UpsertResult {
  const existing = findLogin(vault, origin, username);
  if (!existing) return 'added';
  return cipher.decrypt(existing.password) === password ? 'unchanged' : 'updated';
}

export function validCredential(username: string, password: string): boolean {
  return typeof username === 'string' && typeof password === 'string' && username.length <= MAX_USERNAME && password.length > 0 && password.length <= MAX_PASSWORD;
}

/** Adds or replaces the password of origin+username. Returns the next vault (input untouched). */
export function upsert(
  vault: VaultFile,
  cipher: Cipher,
  input: { origin: string; username: string; password: string },
  now: number,
  newId: () => string,
): { vault: VaultFile; result: UpsertResult } {
  if (!validCredential(input.username, input.password)) throw new TypeError('Invalid login');
  const result = classify(vault, cipher, input.origin, input.username, input.password);
  if (result === 'unchanged') return { vault, result };
  if (result === 'added') {
    if (vault.logins.length >= MAX_LOGINS) throw new Error('Too many saved passwords in this Space');
    const login: StoredLogin = { id: newId(), origin: input.origin, username: input.username, password: cipher.encrypt(input.password), createdAt: now, updatedAt: now, lastUsedAt: null };
    return { vault: { ...vault, logins: [...vault.logins, login] }, result };
  }
  const logins = vault.logins.map((login) =>
    login.origin === input.origin && login.username === input.username ? { ...login, password: cipher.encrypt(input.password), updatedAt: now } : login,
  );
  return { vault: { ...vault, logins }, result };
}
