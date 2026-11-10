import { app, clipboard, dialog, ipcMain, safeStorage, webFrameMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents, type WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  PASSWORD_IPC,
  type CapturedLogin,
  type ImportedLogin,
  type PasswordFillOffer,
  type PasswordFrameFlags,
  type PasswordSaveAnswer,
  type PasswordSavePrompt,
  type PasswordsStatus,
  type SavedLogin,
  type SavedLoginPatch,
} from '../../shared/passwords';
import type { SpaceId } from '../../shared/types';
import { getSettings, onSettingsChanged } from '../settings';
import { getSpace, listSpaces, onSessionCreated, onSpacesChanged } from '../spaces';
import { getTabSpaceId, getTabWebContents, onTabWebContents, tabIdForWebContents } from '../tabs';
import { getMainWindow, sendToChrome } from '../window';
import { loginsToCsv } from './csv';
import { displayHost, isSecureOrigin, normaliseOrigin } from './origin';
import { classify, emptyVault, findLogin, loginsFor, MAX_PASSWORD, MAX_USERNAME, parseVault, toSavedLogin, upsert, validCredential, type Cipher, type VaultFile } from './vault';

/**
 * Built-in password manager (docs/ARCHITECTURE.md → Passwords). Main process only:
 *  - one vault per Space in userData/passwords/<spaceId>.json, every password sealed with
 *    safeStorage (DPAPI / Keychain / keyring); nothing is saved while that is unavailable;
 *  - Burner Spaces keep their vault in memory and lose it with the Space;
 *  - the session preload (src/preload/passwords.ts) reports login forms and submitted
 *    credentials; origins always come from the sending frame, never from the page;
 *  - a password leaves main only to the frame the user picked an account for, or to
 *    vela://passwords after an explicit reveal. Nothing here logs credentials.
 */

const PRELOAD = path.join(__dirname, '..', 'preload', 'passwords.js');
const PRELOAD_ID = 'vela-passwords';
const PROMPT_TTL_MS = 3 * 60_000;
const CLIPBOARD_CLEAR_MS = 30_000;
const SPACE_FILE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const vaults = new Map<SpaceId, VaultFile>();

interface PendingSave {
  prompt: PasswordSavePrompt;
  spaceId: SpaceId;
  origin: string;
  username: string;
  password: string;
  timer: NodeJS.Timeout;
}

interface FrameRef {
  processId: number;
  routingId: number;
}

interface PendingOffer {
  offer: PasswordFillOffer;
  spaceId: SpaceId;
  origin: string;
  frame: FrameRef;
}

const pendingSaves = new Map<string, PendingSave>();
const pendingOffers = new Map<string, PendingOffer>();
let clipboardTimer: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// encryption + storage

/** Linux "basic_text" is a hard-coded key (obfuscation, not encryption): treated as unavailable. */
export function encryptionAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    return true;
  } catch {
    return false;
  }
}

const cipher: Cipher = {
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64')),
};

function isBurner(spaceId: SpaceId): boolean {
  return getSpace(spaceId)?.ephemeral === true;
}

function vaultFile(spaceId: SpaceId): string {
  if (!SPACE_FILE_ID.test(spaceId)) throw new Error('Invalid space id');
  return path.join(app.getPath('userData'), 'passwords', `${spaceId}.json`);
}

function loadVault(spaceId: SpaceId): VaultFile {
  const cached = vaults.get(spaceId);
  if (cached) return cached;
  let vault = emptyVault();
  if (!isBurner(spaceId)) {
    const file = vaultFile(spaceId);
    try {
      vault = parseVault(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        try {
          fs.renameSync(file, `${file}.corrupt`);
        } catch {
          /* keep going with an empty vault */
        }
      }
    }
  }
  vaults.set(spaceId, vault);
  return vault;
}

/** Atomic: write a 0600 temp file, fsync, rename over the vault. Burner vaults never touch disk. */
function persist(spaceId: SpaceId, vault: VaultFile): void {
  vaults.set(spaceId, vault);
  if (isBurner(spaceId)) return;
  const file = vaultFile(spaceId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(vault));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function requireSpace(spaceId: unknown): SpaceId {
  if (typeof spaceId !== 'string' || !getSpace(spaceId)) throw new Error('Unknown space');
  return spaceId;
}

function requireEncryption(): void {
  if (!encryptionAvailable()) throw new Error('Passwords cannot be saved: OS encryption (safeStorage) is not available on this system.');
}

// ---------------------------------------------------------------------------
// public API (browser import)

/**
 * Stores imported logins in the Space (encrypted). Existing origin+username pairs are skipped unless the password
 * differs, in which case the imported one wins.
 */
export async function importLogins(spaceId: SpaceId, logins: readonly ImportedLogin[]): Promise<{ added: number; updated: number; skipped: number }> {
  const id = requireSpace(spaceId);
  requireEncryption();
  let vault = loadVault(id);
  const counts = { added: 0, updated: 0, skipped: 0 };
  const now = Date.now();
  for (const login of logins) {
    const origin = typeof login?.url === 'string' ? normaliseOrigin(login.url) : null;
    if (!origin || !validCredential(login.username, login.password)) {
      counts.skipped += 1;
      continue;
    }
    try {
      const next = upsert(vault, cipher, { origin, username: login.username, password: login.password }, now, randomUUID);
      vault = next.vault;
      if (next.result === 'unchanged') counts.skipped += 1;
      else counts[next.result] += 1;
    } catch {
      counts.skipped += 1;
    }
  }
  if (counts.added + counts.updated > 0) persist(id, vault);
  return counts;
}

export function listLogins(spaceId: SpaceId): SavedLogin[] {
  const id = requireSpace(spaceId);
  return loadVault(id)
    .logins.map((login) => toSavedLogin(id, login))
    .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
}

// ---------------------------------------------------------------------------
// frames (session preload)

interface FrameContext {
  tabId: number;
  spaceId: SpaceId;
  origin: string;
  frame: WebFrameMain;
}

/** Tab frames only; the frame must be the top frame or same-origin with it. */
function frameContext(event: IpcMainEvent): FrameContext | null {
  const frame = event.senderFrame;
  if (!frame) return null;
  const tabId = tabIdForWebContents(event.sender.id);
  if (tabId === null) return null;
  const spaceId = getTabSpaceId(tabId);
  if (!spaceId) return null;
  const origin = normaliseOrigin(frame.url);
  if (!origin) return null;
  const topOrigin = normaliseOrigin(frame.top?.url ?? '');
  if (topOrigin !== origin) return null;
  return { tabId, spaceId, origin, frame };
}

function frameFlags(): PasswordFrameFlags {
  const settings = getSettings();
  return { save: settings.offerToSavePasswords && encryptionAvailable(), fill: settings.passwordAutofill };
}

function cancelSave(id: string): void {
  const pending = pendingSaves.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingSaves.delete(id);
  sendToChrome(PASSWORD_IPC.saveCancel, id);
}

function cancelOffer(id: string): void {
  if (!pendingOffers.delete(id)) return;
  sendToChrome(PASSWORD_IPC.fillCancel, id);
}

function cancelOffersForTab(tabId: number): void {
  for (const [id, pending] of pendingOffers) if (pending.offer.tabId === tabId) cancelOffer(id);
}

function parseCaptured(raw: unknown): CapturedLogin | null {
  if (!raw || typeof raw !== 'object') return null;
  const { username, password } = raw as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const trimmed = username.trim();
  return validCredential(trimmed, password) ? { username: trimmed, password } : null;
}

function onCaptured(event: IpcMainEvent, raw: unknown): void {
  const context = frameContext(event);
  const login = parseCaptured(raw);
  if (!context || !login || !frameFlags().save) return;
  const vault = loadVault(context.spaceId);
  if (vault.never.includes(context.origin)) return;
  const kind = classify(vault, cipher, context.origin, login.username, login.password);
  if (kind === 'unchanged') return;
  for (const [id, pending] of pendingSaves) if (pending.prompt.tabId === context.tabId) cancelSave(id);
  const id = randomUUID();
  const prompt: PasswordSavePrompt = {
    id,
    tabId: context.tabId,
    host: displayHost(context.origin),
    username: login.username,
    kind: kind === 'added' ? 'save' : 'update',
    burner: isBurner(context.spaceId),
  };
  const timer = setTimeout(() => cancelSave(id), PROMPT_TTL_MS);
  timer.unref?.();
  pendingSaves.set(id, { prompt, spaceId: context.spaceId, origin: context.origin, username: login.username, password: login.password, timer });
  sendToChrome(PASSWORD_IPC.savePrompt, prompt);
}

function onFormSeen(event: IpcMainEvent): void {
  const context = frameContext(event);
  if (!context || !getSettings().passwordAutofill) return;
  const accounts = loginsFor(loadVault(context.spaceId), context.origin);
  if (accounts.length === 0) return;
  for (const pending of pendingOffers.values()) if (pending.offer.tabId === context.tabId && pending.origin === context.origin) return;
  cancelOffersForTab(context.tabId);
  const id = randomUUID();
  const offer: PasswordFillOffer = {
    id,
    tabId: context.tabId,
    host: displayHost(context.origin),
    insecure: !isSecureOrigin(context.origin),
    accounts: accounts.map((login) => ({ id: login.id, username: login.username })),
  };
  pendingOffers.set(id, { offer, spaceId: context.spaceId, origin: context.origin, frame: { processId: context.frame.processId, routingId: context.frame.routingId } });
  sendToChrome(PASSWORD_IPC.fillOffer, offer);
}

// ---------------------------------------------------------------------------
// chrome UI

function answerSave(id: unknown, answer: unknown): void {
  if (typeof id !== 'string') throw new TypeError('Invalid id');
  if (answer !== 'save' && answer !== 'never' && answer !== 'dismiss') throw new TypeError('Invalid answer');
  const pending = pendingSaves.get(id);
  if (!pending) return;
  cancelSave(id);
  if (!getSpace(pending.spaceId)) return;
  const choice = answer as PasswordSaveAnswer;
  if (choice === 'dismiss') return;
  const vault = loadVault(pending.spaceId);
  if (choice === 'never') {
    if (!vault.never.includes(pending.origin)) persist(pending.spaceId, { ...vault, never: [...vault.never, pending.origin] });
    return;
  }
  requireEncryption();
  const next = upsert(vault, cipher, { origin: pending.origin, username: pending.username, password: pending.password }, Date.now(), randomUUID);
  if (next.result !== 'unchanged') persist(pending.spaceId, next.vault);
}

/** The user picked an account: re-check the frame and its origin, then send the login to that frame only. */
function fill(offerId: unknown, loginId: unknown): void {
  if (typeof offerId !== 'string' || typeof loginId !== 'string') throw new TypeError('Invalid id');
  const pending = pendingOffers.get(offerId);
  if (!pending || !getSpace(pending.spaceId)) return;
  const login = loadVault(pending.spaceId).logins.find((candidate) => candidate.id === loginId && candidate.origin === pending.origin);
  if (!login) return;
  let frame: WebFrameMain | null | undefined;
  try {
    frame = webFrameMain.fromId(pending.frame.processId, pending.frame.routingId);
  } catch {
    frame = null;
  }
  if (!frame || frame.detached) return cancelOffer(offerId);
  const wc = getTabWebContents(pending.offer.tabId);
  if (!wc || wc.isDestroyed() || getTabSpaceId(pending.offer.tabId) !== pending.spaceId) return cancelOffer(offerId);
  if (normaliseOrigin(frame.url) !== pending.origin || normaliseOrigin(frame.top?.url ?? '') !== pending.origin) return cancelOffer(offerId);
  frame.send(PASSWORD_IPC.frameFill, { username: login.username, password: cipher.decrypt(login.password) });
  const vault = loadVault(pending.spaceId);
  persist(pending.spaceId, { ...vault, logins: vault.logins.map((entry) => (entry.id === login.id ? { ...entry, lastUsedAt: Date.now() } : entry)) });
  cancelOffer(offerId);
}

// ---------------------------------------------------------------------------
// vela://passwords

function fromPasswordsPage(event: IpcMainInvokeEvent): boolean {
  try {
    return new URL(event.senderFrame?.url ?? '').host === 'passwords';
  } catch {
    return false;
  }
}

function storedLogin(spaceId: unknown, loginId: unknown) {
  const id = requireSpace(spaceId);
  if (typeof loginId !== 'string') throw new TypeError('Invalid id');
  const vault = loadVault(id);
  const login = vault.logins.find((candidate) => candidate.id === loginId);
  if (!login) throw new Error('Login not found');
  return { id, vault, login };
}

function status(): PasswordsStatus {
  return {
    encryption: encryptionAvailable(),
    spaces: listSpaces().map((space) => {
      const vault = loadVault(space.id);
      return { spaceId: space.id, name: space.name, color: space.color, burner: space.ephemeral, count: vault.logins.length, never: [...vault.never] };
    }),
  };
}

/** Copies in main (the password never reaches the page) and clears it after 30 s if still unchanged. */
function copy(spaceId: unknown, loginId: unknown, field: unknown): void {
  const { login } = storedLogin(spaceId, loginId);
  if (field !== 'password' && field !== 'username') throw new TypeError('Invalid field');
  const text = field === 'password' ? cipher.decrypt(login.password) : login.username;
  clipboard.writeText(text);
  if (field !== 'password') return;
  if (clipboardTimer) clearTimeout(clipboardTimer);
  clipboardTimer = setTimeout(() => {
    clipboardTimer = null;
    void Promise.resolve(clipboard.readText())
      .then((current) => {
        if (current === text) clipboard.clear();
      })
      .catch(() => undefined);
  }, CLIPBOARD_CLEAR_MS);
  clipboardTimer.unref?.();
}

function updateLogin(spaceId: unknown, loginId: unknown, rawPatch: unknown): SavedLogin {
  const { id, vault, login } = storedLogin(spaceId, loginId);
  if (!rawPatch || typeof rawPatch !== 'object') throw new TypeError('Invalid patch');
  const patch = rawPatch as SavedLoginPatch;
  const username = patch.username === undefined ? login.username : patch.username;
  if (typeof username !== 'string' || username.length > MAX_USERNAME) throw new TypeError('Invalid username');
  if (patch.password !== undefined && (typeof patch.password !== 'string' || patch.password.length === 0 || patch.password.length > MAX_PASSWORD)) throw new TypeError('Invalid password');
  const clash = findLogin(vault, login.origin, username);
  if (clash && clash.id !== login.id) throw new Error('This username is already saved for the site');
  if (patch.password !== undefined) requireEncryption();
  const next = { ...login, username, password: patch.password === undefined ? login.password : cipher.encrypt(patch.password), updatedAt: Date.now() };
  persist(id, { ...vault, logins: vault.logins.map((entry) => (entry.id === login.id ? next : entry)) });
  return toSavedLogin(id, next);
}

function removeLogin(spaceId: unknown, loginId: unknown): void {
  const { id, vault, login } = storedLogin(spaceId, loginId);
  persist(id, { ...vault, logins: vault.logins.filter((entry) => entry.id !== login.id) });
}

function removeNever(spaceId: unknown, origin: unknown): void {
  const id = requireSpace(spaceId);
  if (typeof origin !== 'string') throw new TypeError('Invalid origin');
  const vault = loadVault(id);
  persist(id, { ...vault, never: vault.never.filter((entry) => entry !== origin) });
}

async function exportCsv(spaceId: unknown): Promise<{ saved: boolean; count: number }> {
  const id = requireSpace(spaceId);
  const vault = loadVault(id);
  const win = getMainWindow();
  const options = { title: 'Export passwords', defaultPath: path.join(app.getPath('documents'), 'Vela Passwords.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] };
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { saved: false, count: 0 };
  const csv = loginsToCsv(vault.logins.map((login) => ({ origin: login.origin, username: login.username, password: cipher.decrypt(login.password) })));
  fs.writeFileSync(result.filePath, csv, { encoding: 'utf8', mode: 0o600 });
  return { saved: true, count: vault.logins.length };
}

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

/** Registered by ipc.ts with its sender-checked wrappers; pages:* additionally require vela://passwords. */
export function registerPasswordIpc(handleChrome: ChromeHandler, handlePages: PagesHandler): void {
  const own = (channel: string, fn: (...args: unknown[]) => unknown): void =>
    handlePages(channel, (event, ...args) => {
      if (!fromPasswordsPage(event)) throw new Error('Forbidden');
      return fn(...args);
    });
  handleChrome(PASSWORD_IPC.answerSave, (id, answer) => answerSave(id, answer));
  handleChrome(PASSWORD_IPC.fill, (offerId, loginId) => fill(offerId, loginId));
  handleChrome(PASSWORD_IPC.dismissOffer, (offerId) => {
    if (typeof offerId === 'string') cancelOffer(offerId);
  });
  own(PASSWORD_IPC.status, () => status());
  own(PASSWORD_IPC.list, (spaceId) => listLogins(requireSpace(spaceId)));
  own(PASSWORD_IPC.reveal, (spaceId, loginId) => cipher.decrypt(storedLogin(spaceId, loginId).login.password));
  own(PASSWORD_IPC.copy, (spaceId, loginId, field) => copy(spaceId, loginId, field));
  own(PASSWORD_IPC.update, (spaceId, loginId, patch) => updateLogin(spaceId, loginId, patch));
  own(PASSWORD_IPC.remove, (spaceId, loginId) => removeLogin(spaceId, loginId));
  own(PASSWORD_IPC.exportCsv, (spaceId) => exportCsv(spaceId));
  own(PASSWORD_IPC.neverRemove, (spaceId, origin) => removeNever(spaceId, origin));
}

function watchTab(wc: WebContents, tabId: number): void {
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) cancelOffersForTab(tabId);
  });
  wc.once('destroyed', () => {
    cancelOffersForTab(tabId);
    for (const [id, pending] of pendingSaves) if (pending.prompt.tabId === tabId) cancelSave(id);
  });
}

export function initPasswords(): void {
  ipcMain.on(PASSWORD_IPC.frameFlags, (event) => {
    try {
      event.returnValue = frameContext(event) ? frameFlags() : { save: false, fill: false };
    } catch {
      event.returnValue = { save: false, fill: false };
    }
  });
  ipcMain.on(PASSWORD_IPC.frameFormSeen, (event) => {
    try {
      onFormSeen(event);
    } catch {
      /* never break the page */
    }
  });
  ipcMain.on(PASSWORD_IPC.frameCaptured, (event, raw: unknown) => {
    try {
      onCaptured(event, raw);
    } catch {
      /* never break the page */
    }
  });
  onSessionCreated((session) => {
    if (session.getPreloadScripts().some((script) => script.id === PRELOAD_ID)) return;
    session.registerPreloadScript({ id: PRELOAD_ID, type: 'frame', filePath: PRELOAD });
  });
  onTabWebContents(watchTab);
  onSettingsChanged((settings) => {
    if (!settings.offerToSavePasswords) for (const id of [...pendingSaves.keys()]) cancelSave(id);
    if (!settings.passwordAutofill) for (const id of [...pendingOffers.keys()]) cancelOffer(id);
  });
  let known = new Set(listSpaces().map((space) => space.id));
  onSpacesChanged(() => {
    const current = new Set(listSpaces().map((space) => space.id));
    for (const id of known) {
      if (current.has(id)) continue;
      vaults.delete(id);
      for (const [pendingId, pending] of pendingSaves) if (pending.spaceId === id) cancelSave(pendingId);
      for (const [offerId, pending] of pendingOffers) if (pending.spaceId === id) cancelOffer(offerId);
      try {
        fs.rmSync(vaultFile(id), { force: true });
      } catch {
        /* best effort */
      }
    }
    known = current;
  });
}
