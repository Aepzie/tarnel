import { dialog, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  HISTORY_IMPORT_DAYS,
  HISTORY_IMPORT_LIMIT,
  IMPORT_IPC,
  type ImportKind,
  type PasswordCsvPreview,
  type PasswordImportResult,
} from '../../shared/import';
import type { ImportedLogin } from '../../shared/passwords';
import { importBookmarkTree } from '../bookmarks';
import { importHistory } from '../history';
import { importLogins } from '../passwords';
import { getSpace } from '../spaces';
import { createStore, type JsonStore } from '../store';
import { getMainWindow } from '../window';
import { countBookmarks } from './chromium-parse';
import { parsePasswordCsv } from './csv';
import { listProfiles, profileLabel, readBookmarks, readHistory } from './sources';

type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

const MAX_CSV_BYTES = 20 * 1024 * 1024;
const PENDING_TTL_MS = 10 * 60_000;

/** Parsed password files waiting for the user to confirm; passwords never leave main. */
const pending = new Map<string, { logins: ImportedLogin[]; timer: NodeJS.Timeout }>();

let hintStore: JsonStore<{ dismissed: boolean }> | null = null;
const hints = (): JsonStore<{ dismissed: boolean }> => (hintStore ??= createStore('import-hint', { dismissed: false }));

function text(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new TypeError(`Invalid ${name}`);
  return value;
}

function space(value: unknown): string {
  const id = text(value, 64, 'space id');
  if (!getSpace(id)) throw new Error('Unknown Space');
  return id;
}

function kind(value: unknown): ImportKind {
  if (value !== 'bookmarks' && value !== 'history') throw new TypeError('Invalid import kind');
  return value;
}

function dismissHint(): void {
  if (!hints().get().dismissed) hints().set({ dismissed: true });
}

async function run(profileId: string, what: ImportKind, spaceId: string): Promise<number> {
  if (what === 'history') {
    const count = importHistory(await readHistory(profileId, HISTORY_IMPORT_DAYS, HISTORY_IMPORT_LIMIT));
    dismissHint();
    return count;
  }
  const tree = await readBookmarks(profileId);
  if (countBookmarks(tree) === 0) return 0;
  const added = await importBookmarkTree(spaceId, `Imported from ${profileLabel(profileId)}`, tree);
  dismissHint();
  return added;
}

function forget(token: string): void {
  const entry = pending.get(token);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.logins.length = 0;
  pending.delete(token);
}

async function pickPasswordCsv(): Promise<PasswordCsvPreview | null> {
  const win = getMainWindow();
  const options: Electron.OpenDialogOptions = {
    title: 'Choose an exported passwords file',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const file = result.canceled ? undefined : result.filePaths[0];
  if (!file) return null;
  if ((await stat(file)).size > MAX_CSV_BYTES) throw new Error('This file is too large to be a passwords export.');
  const parsed = parsePasswordCsv(await readFile(file, 'utf8'));
  const token = randomUUID();
  pending.set(token, { logins: parsed.logins, timer: setTimeout(() => forget(token), PENDING_TTL_MS) });
  return { token, fileName: basename(file), format: parsed.format, count: parsed.logins.length, skipped: parsed.skipped };
}

async function importPasswords(token: string, spaceId: string): Promise<PasswordImportResult> {
  const entry = pending.get(token);
  if (!entry) throw new Error('Choose the file again — the import expired.');
  try {
    const result = await importLogins(spaceId, entry.logins);
    dismissHint();
    return result;
  } finally {
    forget(token);
  }
}

function hint(): { browserName: string } | null {
  if (hints().get().dismissed) return null;
  const profiles = listProfiles().filter((profile) => profile.hasBookmarks || profile.hasHistory);
  const preferred = profiles.find((profile) => profile.browser === 'chrome') ?? profiles[0];
  return preferred ? { browserName: preferred.browserName } : null;
}

export function registerImportIpc(handle: PagesHandler): void {
  handle(IMPORT_IPC.profiles, () => listProfiles());
  handle(IMPORT_IPC.run, (_event, profileId, what, spaceId) => run(text(profileId, 512, 'profile'), kind(what), space(spaceId)));
  handle(IMPORT_IPC.pickPasswordCsv, () => pickPasswordCsv());
  handle(IMPORT_IPC.importPasswords, (_event, token, spaceId) => importPasswords(text(token, 64, 'token'), space(spaceId)));
  handle(IMPORT_IPC.discardPasswords, (_event, token) => forget(text(token, 64, 'token')));
  handle(IMPORT_IPC.hint, () => hint());
  handle(IMPORT_IPC.dismissHint, () => dismissHint());
}
