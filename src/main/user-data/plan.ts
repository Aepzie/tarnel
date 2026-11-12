/**
 * Profile location after the Vela → Tarnel rename. Pure decision logic (no electron, no fs) so it
 * is unit-tested; src/main/user-data/index.ts does the filesystem work.
 *
 * Electron derives userData from productName (%APPDATA%/Tarnel, ~/Library/Application Support/Tarnel,
 * ~/.config/Tarnel). A profile from before the rename lives in the sibling "Vela" directory and is
 * moved over once, on the first start that finds no Tarnel profile yet.
 */

/** Isolated profile for development/testing (separate single-instance lock + storage). */
export const USER_DATA_ENV = 'TARNEL_USER_DATA';
/** Still honoured so existing scripts and test setups keep working. */
export const LEGACY_USER_DATA_ENV = 'VELA_USER_DATA';
/** Directory name (under appData) of a profile from before the rename. */
export const LEGACY_PROFILE_DIR = 'Vela';

/**
 * Entries Chromium/Electron or boot.ts may create before the profile is used for real. A directory
 * holding only these is not a profile (it carries no user data).
 */
const NON_PROFILE_ENTRIES = new Set(['compile-cache', 'crashpad', 'logs', 'dictionaries', 'lockfile', 'singletonlock', 'singletoncookie', 'singletonsocket']);

export function userDataOverride(env: Readonly<Record<string, string | undefined>>): string | null {
  const value = env[USER_DATA_ENV]?.trim() || env[LEGACY_USER_DATA_ENV]?.trim();
  return value ? value : null;
}

/** `entries`: the directory listing, or null when the directory does not exist. */
export function holdsProfile(entries: readonly string[] | null): boolean {
  return !!entries && entries.some((name) => !NON_PROFILE_ENTRIES.has(name.toLowerCase()));
}

export interface UserDataMigrationInput {
  /** Value of TARNEL_USER_DATA / VELA_USER_DATA, if set. */
  override: string | null;
  /** The Tarnel userData directory and its listing (null = missing). */
  target: string;
  targetEntries: readonly string[] | null;
  /** The pre-rename Vela directory and its listing (null = missing). */
  legacy: string;
  legacyEntries: readonly string[] | null;
}

export type UserDataMigrationPlan =
  | { action: 'none'; reason: 'override' | 'same-dir' | 'target-in-use' | 'no-legacy-profile' }
  | { action: 'migrate'; from: string; to: string };

export function planUserDataMigration(input: UserDataMigrationInput): UserDataMigrationPlan {
  if (input.override) return { action: 'none', reason: 'override' };
  if (samePath(input.target, input.legacy)) return { action: 'none', reason: 'same-dir' };
  if (holdsProfile(input.targetEntries)) return { action: 'none', reason: 'target-in-use' };
  if (!holdsProfile(input.legacyEntries)) return { action: 'none', reason: 'no-legacy-profile' };
  return { action: 'migrate', from: input.legacy, to: input.target };
}

function samePath(a: string, b: string): boolean {
  const norm = (path: string): string => path.replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}
