import { app, dialog, safeStorage, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IPC } from '../../shared/ipc';
import { DEFAULT_SYNC_CATEGORIES, type Suggestion, type SyncCategories, type SyncSetupInput, type SyncStatus, type SyncTransportInput } from '../../shared/types';
import { listHistory, mergeSyncedHistory } from '../history';
import { getSettings, onSettingsChanged, updateSettings } from '../settings';
import { importSpace, listSpaces, onSpacesChanged, updateSpace } from '../spaces';
import { onStateChanged, removeSpaceWithTabs, serializeSession } from '../tabs';
import { forgetSpacePermissions } from '../permissions';
import { getMainWindow } from '../window';
import type { SyncEngine } from './engine';
import { SYNC_CONFIG_FILE, type SyncHost } from './host';

/**
 * Main-bundle side of sync: tiny on purpose. The engine (crypto, transports, merge) lives in
 * dist/main/sync.js and is only required when sync is (or is being) turned on.
 */

type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

let engine: SyncEngine | null = null;

function host(): SyncHost {
  return {
    userDataDir: app.getPath('userData'),
    deviceName: os.hostname().slice(0, 64) || 'Vela',
    secureStorageAvailable: () => safeStorage.isEncryptionAvailable(),
    protect: (plain) => safeStorage.encryptString(plain).toString('base64'),
    unprotect: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64')),
    getSettings,
    applySettings: (patch) => void updateSettings(patch),
    listSpaces,
    upsertSpace: (id, fields) => {
      if (listSpaces().some((space) => space.id === id)) updateSpace(id, fields);
      else importSpace(id, fields);
    },
    removeSpace: async (id) => {
      await removeSpaceWithTabs(id);
      forgetSpacePermissions(id);
    },
    listTabs: () => serializeSession(),
    listHistory: (limit) => listHistory('', limit),
    mergeHistory: mergeSyncedHistory,
    onLocalChange: (cb) => {
      onSettingsChanged(() => cb('settings'));
      onSpacesChanged(() => cb('spaces'));
      onStateChanged(() => cb('tabs'));
    },
  };
}

function loadEngine(): SyncEngine {
  if (engine) return engine;
  const mod = require(path.join(__dirname, 'sync.js')) as typeof import('./engine');
  engine = mod.createSyncEngine(host());
  return engine;
}

function enabledOnDisk(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), SYNC_CONFIG_FILE), 'utf8')) as { enabled?: unknown };
    return parsed?.enabled === true;
  } catch {
    return false;
  }
}

/** Called once after boot: loads and starts the engine only when sync is on. */
export function initSync(): void {
  if (enabledOnDisk()) loadEngine().start();
}

export function stopSync(): void {
  engine?.stop();
}

/** Tabs open on the user's other devices (empty and free when sync is off). */
export function remoteTabSuggestions(input: string, limit: number): Suggestion[] {
  return engine?.remoteTabs(input, limit) ?? [];
}

function offStatus(): SyncStatus {
  return {
    enabled: false,
    secureStorage: safeStorage.isEncryptionAvailable(),
    transport: null,
    categories: { ...DEFAULT_SYNC_CATEGORIES },
    syncing: false,
    lastSyncAt: null,
    lastError: null,
    devices: [],
  };
}

// ---------------------------------------------------------------------------
// argument validation (renderer input is untrusted)

function text(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || value.length > max) throw new TypeError(`Invalid ${name}`);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid input');
  return value as Record<string, unknown>;
}

function transportInput(value: unknown): SyncTransportInput {
  const raw = record(value);
  if (raw.kind === 'folder') return { kind: 'folder', path: text(raw.path, 4096, 'folder') };
  if (raw.kind === 'webdav') {
    return { kind: 'webdav', url: text(raw.url, 2048, 'url').trim(), username: text(raw.username, 256, 'username').trim(), password: text(raw.password, 1024, 'password') };
  }
  throw new TypeError('Invalid transport');
}

function categories(value: unknown): SyncCategories {
  const raw = record(value);
  const flag = (name: keyof SyncCategories): boolean => {
    if (typeof raw[name] !== 'boolean') throw new TypeError('Invalid categories');
    return raw[name];
  };
  return { settings: flag('settings'), spaces: flag('spaces'), tabs: flag('tabs'), history: flag('history') };
}

function setupInput(value: unknown): SyncSetupInput {
  const raw = record(value);
  if (raw.mode !== 'create' && raw.mode !== 'join') throw new TypeError('Invalid mode');
  return { transport: transportInput(raw.transport), mode: raw.mode, secret: text(raw.secret, 1024, 'passphrase'), categories: categories(raw.categories) };
}

export function registerSyncIpc(handle: PagesHandler): void {
  const p = IPC.pages;
  handle(p.syncStatus, () => engine?.status() ?? offStatus());
  handle(p.syncPickFolder, async () => {
    const win = getMainWindow();
    const options: Electron.OpenDialogOptions = { title: 'Choose a sync folder', properties: ['openDirectory', 'createDirectory'] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle(p.syncProbe, (_event, transport) => loadEngine().probe(transportInput(transport)));
  handle(p.syncEnable, (_event, input) => loadEngine().enable(setupInput(input)));
  handle(p.syncSetCategories, (_event, value) => loadEngine().setCategories(categories(value)));
  handle(p.syncNow, () => engine?.syncNow() ?? offStatus());
  handle(p.syncRecoveryKey, () => loadEngine().recoveryKey());
  handle(p.syncDisconnect, (_event, wipe) => {
    if (typeof wipe !== 'boolean') throw new TypeError('Invalid flag');
    return engine?.disconnect(wipe) ?? offStatus();
  });
}
