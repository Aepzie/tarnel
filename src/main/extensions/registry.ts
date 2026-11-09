import type { ExtensionSource, ExtensionSpaces, Space, SpaceId } from '../../shared/types';
import { createStore, type JsonStore } from '../store';

/**
 * Installed-extension list (global, userData/extensions.json). Pure data: importing this module
 * never loads the extension machinery, so a browser without extensions pays nothing for it.
 */

export interface InstalledExtension {
  id: string;
  source: ExtensionSource;
  /** Unpacked directory Chromium loads from (CWS: userData/Extensions/<id>/<version>_0). */
  path: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  spaces: ExtensionSpaces;
  pinned: boolean;
  installedAt: number;
}

interface RegistryFile {
  extensions: InstalledExtension[];
}

export const EXTENSION_ID = /^[a-p]{32}$/;

let store: JsonStore<RegistryFile> | null = null;
const listeners = new Set<() => void>();

function isStored(value: unknown): value is InstalledExtension {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<InstalledExtension>;
  return (
    typeof entry.id === 'string' &&
    EXTENSION_ID.test(entry.id) &&
    (entry.source === 'store' || entry.source === 'unpacked') &&
    typeof entry.path === 'string' &&
    entry.path.length > 0
  );
}

function normalize(entry: InstalledExtension): InstalledExtension {
  const spaces = Array.isArray(entry.spaces) ? entry.spaces.filter((id) => typeof id === 'string') : 'all';
  return {
    id: entry.id,
    source: entry.source,
    path: entry.path,
    name: typeof entry.name === 'string' && entry.name ? entry.name : entry.id,
    version: typeof entry.version === 'string' ? entry.version : '',
    description: typeof entry.description === 'string' ? entry.description : '',
    enabled: entry.enabled !== false,
    spaces,
    pinned: entry.pinned === true,
    installedAt: typeof entry.installedAt === 'number' ? entry.installedAt : Date.now(),
  };
}

function requireStore(): JsonStore<RegistryFile> {
  if (store) return store;
  store = createStore<RegistryFile>('extensions', { extensions: [] });
  const file = store.get();
  const list = Array.isArray(file.extensions) ? file.extensions.filter(isStored).map(normalize) : [];
  store.set({ extensions: list });
  return store;
}

function emit(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* ignore listener errors */
    }
  }
}

export function listInstalled(): InstalledExtension[] {
  return requireStore().get().extensions;
}

export function hasInstalled(): boolean {
  return listInstalled().length > 0;
}

export function getInstalled(id: string): InstalledExtension | undefined {
  return listInstalled().find((entry) => entry.id === id);
}

/** Add or replace (same id) an entry. */
export function putInstalled(entry: InstalledExtension): InstalledExtension {
  const next = normalize(entry);
  requireStore().update((file) => {
    const exists = file.extensions.some((current) => current.id === next.id);
    return {
      extensions: exists
        ? file.extensions.map((current) => (current.id === next.id ? next : current))
        : [...file.extensions, next],
    };
  });
  emit();
  return next;
}

export function patchInstalled(id: string, patch: Partial<InstalledExtension>): InstalledExtension {
  const current = getInstalled(id);
  if (!current) throw new Error('Extension is not installed');
  return putInstalled({ ...current, ...patch, id });
}

export function removeInstalled(id: string): void {
  requireStore().update((file) => ({ extensions: file.extensions.filter((entry) => entry.id !== id) }));
  emit();
}

/**
 * Chromium refuses extensions in in-memory sessions, so Burner Spaces never run them;
 * otherwise an enabled extension runs in every Space ('all') or exactly the listed ones.
 */
export function runsIn(entry: InstalledExtension, space: Space): boolean {
  if (space.ephemeral || !entry.enabled) return false;
  return entry.spaces === 'all' || entry.spaces.includes(space.id);
}

export function wantedIn(space: Space): InstalledExtension[] {
  return listInstalled().filter((entry) => runsIn(entry, space));
}

export function onRegistryChanged(cb: () => void): void {
  listeners.add(cb);
}

/** Keep only Spaces that exist and can run extensions. */
export function cleanSpaces(spaces: ExtensionSpaces, all: Space[]): ExtensionSpaces {
  if (spaces === 'all') return 'all';
  const allowed = new Set(all.filter((space) => !space.ephemeral).map((space) => space.id));
  return [...new Set(spaces)].filter((id: SpaceId) => allowed.has(id));
}
