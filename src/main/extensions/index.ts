import { dialog, type IpcMainInvokeEvent } from 'electron';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EXTENSION_IPC } from '../../shared/ipc';
import type { ExtensionAnchor, ExtensionInfo, ExtensionPatch, ExtensionsState, SpaceId } from '../../shared/types';
import { gateSessionReady, getActiveSpaceId, getSpaceSession, listSpaces, onSessionCreated, onSessionRemoved, onSpacesChanged } from '../spaces';
import { closeTab, getBrowserState, getTabSpaceId, onStateChanged, onTabWebContents, tabIdForWebContents } from '../tabs';
import { getMainWindow, sendToChrome } from '../window';
import { forgetManifest, readManifest, readMeta, staticInfo } from './manifest';
import {
  cleanSpaces,
  EXTENSION_ID,
  getInstalled,
  hasInstalled,
  listInstalled,
  onRegistryChanged,
  patchInstalled,
  putInstalled,
  removeInstalled,
  type InstalledExtension,
} from './registry';
import {
  activateAction,
  activeActions,
  attachTab,
  clearError,
  forgetSession,
  loadError,
  noteActiveTab,
  onRuntimeChanged,
  openOptionsPage,
  registerSession,
  syncAll,
  unloadEverywhere,
} from './runtime';
import { downloadFromStore, downloadUpdate, findUpdates, parseStoreInput, removeStoreFiles } from './webstore';

/** First update check shortly after launch, then every 5 hours (CWS extensions only). */
const UPDATE_FIRST_MS = 2 * 60_000;
const UPDATE_EVERY_MS = 5 * 60 * 60_000;
/** Never hold a Space's first page load for longer than this while extensions load. */
const GATE_TIMEOUT_MS = 3000;

let emitQueued = false;
let emitSeq = 0;
let updateTimer: NodeJS.Timeout | null = null;

function toInfo(entry: InstalledExtension): ExtensionInfo {
  const { icon, optionsPage } = staticInfo(entry.path);
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    description: entry.description,
    source: entry.source,
    enabled: entry.enabled,
    spaces: entry.spaces,
    pinned: entry.pinned,
    icon,
    hasOptions: optionsPage !== null,
    error: entry.enabled ? loadError(entry.id) : null,
  };
}

export function listExtensions(): ExtensionInfo[] {
  return listInstalled().map(toInfo);
}

async function buildState(): Promise<ExtensionsState> {
  return { extensions: listExtensions(), actions: await activeActions() };
}

/** Coalesced push of the toolbar state to the chrome UI. */
function emitState(): void {
  if (emitQueued) return;
  emitQueued = true;
  setImmediate(() => {
    emitQueued = false;
    const seq = ++emitSeq;
    void buildState().then(
      (state) => {
        if (seq === emitSeq) sendToChrome(EXTENSION_IPC.changed, state);
      },
      () => undefined,
    );
  });
}

function infoOf(id: string): ExtensionInfo {
  const entry = getInstalled(id);
  if (!entry) throw new Error('Extension is not installed');
  return toInfo(entry);
}

export async function installFromStore(input: string): Promise<ExtensionInfo> {
  const id = parseStoreInput(input);
  if (!id) throw new Error('Paste a Chrome Web Store link or a 32-letter extension ID');
  if (getInstalled(id)) return infoOf(id);
  const path = await downloadFromStore(id);
  let meta;
  try {
    meta = await readMeta(path);
  } catch (error) {
    await removeStoreFiles(path);
    throw error;
  }
  putInstalled({
    id,
    source: 'store',
    path,
    ...meta,
    enabled: true,
    spaces: 'all',
    pinned: false,
    installedAt: Date.now(),
  });
  await syncAll();
  return infoOf(id);
}

/** Chromium derives an unpacked extension's ID from its path (or manifest key): ask it. */
async function probeId(dir: string): Promise<string> {
  const space = listSpaces().find((candidate) => !candidate.ephemeral);
  if (!space) throw new Error('Extensions need a regular (non-Burner) Space');
  const extensions = getSpaceSession(space.id).extensions;
  const existing = extensions.getAllExtensions().find((extension) => resolve(extension.path) === resolve(dir));
  if (existing) return existing.id;
  const extension = await extensions.loadExtension(dir);
  extensions.removeExtension(extension.id);
  return extension.id;
}

export async function loadUnpacked(dir: string): Promise<ExtensionInfo> {
  if (!(await stat(dir).catch(() => null))?.isDirectory()) throw new Error('Choose a folder');
  await readManifest(dir);
  const meta = await readMeta(dir);
  const id = await probeId(dir);
  if (!EXTENSION_ID.test(id)) throw new Error('Unexpected extension ID');
  const current = getInstalled(id);
  if (current?.source === 'store') throw new Error('This extension is already installed from the Chrome Web Store');
  forgetManifest(dir);
  unloadEverywhere(id);
  putInstalled({
    id,
    source: 'unpacked',
    path: dir,
    ...meta,
    enabled: current?.enabled ?? true,
    spaces: current?.spaces ?? 'all',
    pinned: current?.pinned ?? false,
    installedAt: current?.installedAt ?? Date.now(),
  });
  await syncAll();
  return infoOf(id);
}

async function pickUnpacked(): Promise<ExtensionInfo | null> {
  const win = getMainWindow();
  const options = { title: 'Load unpacked extension', properties: ['openDirectory' as const] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const dir = result.canceled ? undefined : result.filePaths[0];
  return dir ? loadUnpacked(dir) : null;
}

export async function updateExtension(id: string, patch: ExtensionPatch): Promise<ExtensionInfo> {
  const next: Partial<InstalledExtension> = {};
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.pinned !== undefined) next.pinned = patch.pinned;
  if (patch.spaces !== undefined) next.spaces = cleanSpaces(patch.spaces, listSpaces());
  patchInstalled(id, next);
  await syncAll();
  return infoOf(id);
}

/** Re-read an extension from disk (developer workflow for unpacked folders). */
export async function reloadExtension(id: string): Promise<ExtensionInfo> {
  const entry = getInstalled(id);
  if (!entry) throw new Error('Extension is not installed');
  const meta = await readMeta(entry.path);
  forgetManifest(entry.path);
  unloadEverywhere(id);
  clearError(id);
  patchInstalled(id, meta);
  await syncAll();
  return infoOf(id);
}

export async function removeExtension(id: string): Promise<void> {
  const entry = getInstalled(id);
  if (!entry) return;
  removeInstalled(id);
  await syncAll();
  unloadEverywhere(id);
  for (const tab of getBrowserState().tabs) if (tab.url.startsWith(`chrome-extension://${id}/`)) closeTab(tab.id);
  clearError(id);
  forgetManifest(entry.path);
  if (entry.source === 'store') await removeStoreFiles(resolve(entry.path, '..'));
}

async function checkForUpdates(): Promise<void> {
  const store = listInstalled().filter((entry) => entry.source === 'store');
  const outdated = await findUpdates(store.map(({ id, version }) => ({ id, version })));
  for (const id of outdated) {
    const entry = getInstalled(id);
    if (!entry) continue;
    try {
      const path = await downloadUpdate(id, entry.path);
      const meta = await readMeta(path);
      unloadEverywhere(id);
      patchInstalled(id, { path, ...meta });
      await syncAll();
      forgetManifest(entry.path);
      await removeStoreFiles(entry.path);
    } catch {
      /* try again on the next check */
    }
  }
}

function scheduleUpdates(): void {
  if (updateTimer || !listInstalled().some((entry) => entry.source === 'store')) return;
  const run = (delay: number): void => {
    updateTimer = setTimeout(() => {
      void checkForUpdates()
        .catch(() => undefined)
        .finally(() => run(UPDATE_EVERY_MS));
    }, delay);
    updateTimer.unref();
  };
  run(UPDATE_FIRST_MS);
}

function withTimeout(work: Promise<void>): Promise<void> {
  return Promise.race([work, new Promise<void>((done) => setTimeout(done, GATE_TIMEOUT_MS).unref())]);
}

/**
 * Wire extensions into the browser. Cheap when nothing is installed: no library is imported, no
 * session is touched, and Space sessions open without waiting.
 */
export function initExtensions(): void {
  onSessionCreated((session, space) => {
    const loading = registerSession(session, space.id);
    if (loading) gateSessionReady(space.id, withTimeout(loading));
  });
  onSessionRemoved(forgetSession);
  onTabWebContents((wc) => attachTab(wc));
  onStateChanged(() => {
    if (noteActiveTab() && hasInstalled()) emitState();
  });
  onSpacesChanged(() => {
    if (hasInstalled()) void syncAll();
  });
  onRegistryChanged(() => {
    emitState();
    scheduleUpdates();
  });
  onRuntimeChanged(emitState);
  scheduleUpdates();
}

// ---------------------------------------------------------------------------
// IPC (registered through ipc.ts so sender validation stays in one place)

type Register = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type RegisterPages = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

function extensionId(value: unknown): string {
  if (typeof value !== 'string' || !EXTENSION_ID.test(value)) throw new TypeError('Invalid extension id');
  return value;
}

function anchor(value: unknown): ExtensionAnchor {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid anchor');
  const raw = value as Record<string, unknown>;
  const num = (v: unknown): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 100_000) throw new TypeError('Invalid anchor');
    return Math.round(v);
  };
  return { x: num(raw.x), y: num(raw.y), width: Math.max(0, num(raw.width)), height: Math.max(0, num(raw.height)) };
}

function patchOf(value: unknown): ExtensionPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid patch');
  const raw = value as Record<string, unknown>;
  const patch: ExtensionPatch = {};
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') throw new TypeError('Invalid enabled');
    patch.enabled = raw.enabled;
  }
  if (raw.pinned !== undefined) {
    if (typeof raw.pinned !== 'boolean') throw new TypeError('Invalid pinned');
    patch.pinned = raw.pinned;
  }
  if (raw.spaces !== undefined) {
    const spaces = raw.spaces;
    const valid = spaces === 'all' || (Array.isArray(spaces) && spaces.length <= 256 && spaces.every((id) => typeof id === 'string' && id.length <= 128));
    if (!valid) throw new TypeError('Invalid spaces');
    patch.spaces = spaces as ExtensionPatch['spaces'];
  }
  return patch;
}

function senderSpace(event: IpcMainInvokeEvent): SpaceId | null {
  const tabId = tabIdForWebContents(event.sender.id);
  return tabId === null ? null : getTabSpaceId(tabId);
}

export function registerExtensionIpc(chrome: Register, pages: RegisterPages): void {
  const X = EXTENSION_IPC;
  chrome(X.get, () => buildState());
  chrome(X.activate, (id, rect, kind) => {
    if (kind !== undefined && kind !== 'click' && kind !== 'contextmenu') throw new TypeError('Invalid kind');
    activateAction(extensionId(id), anchor(rect), kind === 'contextmenu' ? 'contextmenu' : 'click');
  });
  chrome(X.setPinned, async (id, pinned) => {
    if (typeof pinned !== 'boolean') throw new TypeError('Invalid pinned');
    await updateExtension(extensionId(id), { pinned });
  });
  chrome(X.options, (id) => openOptionsPage(extensionId(id), getActiveSpaceId()));

  pages(X.list, () => listExtensions());
  pages(X.install, (_event, input) => {
    if (typeof input !== 'string' || input.length > 2048) throw new TypeError('Invalid input');
    return installFromStore(input);
  });
  pages(X.loadUnpacked, () => pickUnpacked());
  pages(X.update, (_event, id, patch) => updateExtension(extensionId(id), patchOf(patch)));
  pages(X.reload, (_event, id) => reloadExtension(extensionId(id)));
  pages(X.remove, (_event, id) => removeExtension(extensionId(id)));
  pages(X.pageOptions, (event, id) => openOptionsPage(extensionId(id), senderSpace(event)));
}
