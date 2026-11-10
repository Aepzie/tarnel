import { app, type DownloadItem, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { IPC } from '../shared/ipc';
import { isDangerousUrlChain } from './safety';
import type { DownloadState } from '../shared/types';
import { sendToChrome } from './window';
import { formatZoneIdentifier } from './zone-identifier';

const EMIT_INTERVAL_MS = 250;
const attached = new WeakSet<Session>();
const paths = new Map<string, { path: string; done: boolean; dangerous: boolean }>();
/** Paths claimed by in-progress downloads that do not exist on disk yet. */
const reserved = new Set<string>();

function sanitize(name: string): string {
  const clean = basename(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 200);
  return clean || 'download';
}

function uniquePath(dir: string, filename: string): string {
  const name = sanitize(filename);
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = join(dir, name);
  for (let n = 1; existsSync(candidate) || reserved.has(candidate); n++) {
    candidate = join(dir, `${stem} (${n})${ext}`);
  }
  return candidate;
}

function snapshot(id: string, item: DownloadItem, path: string, state: DownloadState['state']): DownloadState {
  return {
    id,
    filename: basename(path),
    path,
    receivedBytes: item.getReceivedBytes(),
    totalBytes: item.getTotalBytes(),
    state,
  };
}

/**
 * Mark-of-the-Web on Windows: tag the finished file as coming from the internet zone so
 * SmartScreen, Defender and Office treat it like a Chrome/Edge download. Best effort (FAT32/exFAT
 * and some network shares have no alternate data streams).
 */
function markOfTheWeb(path: string, item: DownloadItem, referrerUrl: string, includeUrls: boolean): void {
  if (process.platform !== 'win32') return;
  const chain = item.getURLChain();
  const hostUrl = chain[chain.length - 1] ?? item.getURL();
  writeFile(`${path}:Zone.Identifier`, formatZoneIdentifier({ hostUrl, referrerUrl, includeUrls })).catch(() => undefined);
}

export function attachDownloads(session: Session): void {
  if (attached.has(session)) return;
  attached.add(session);
  session.on('will-download', (_event, item, webContents) => {
    const path = uniquePath(app.getPath('downloads'), item.getFilename());
    item.setSavePath(path);
    reserved.add(path);
    const id = randomUUID();
    const referrerUrl = webContents && !webContents.isDestroyed() ? webContents.getURL() : '';
    paths.set(id, { path, done: false, dangerous: isDangerousUrlChain(item.getURLChain()) });

    let lastEmit = 0;
    let timer: NodeJS.Timeout | null = null;
    const emit = (): void => {
      timer = null;
      lastEmit = Date.now();
      sendToChrome(IPC.chromeEvents.download, snapshot(id, item, path, item.getState() === 'interrupted' ? 'interrupted' : 'progressing'));
    };
    emit();
    item.on('updated', () => {
      if (timer) return;
      const wait = Math.max(0, EMIT_INTERVAL_MS - (Date.now() - lastEmit));
      timer = setTimeout(emit, wait);
    });
    item.once('done', (_e, state) => {
      if (timer) clearTimeout(timer);
      reserved.delete(path);
      const entry = paths.get(id);
      if (entry) entry.done = state === 'completed';
      if (state === 'completed') markOfTheWeb(path, item, referrerUrl, session.isPersistent());
      sendToChrome(IPC.chromeEvents.download, snapshot(id, item, path, state));
    });
  });
}

/** Path of a completed download (for opening), or null. */
export function getCompletedDownloadPath(id: string): string | null {
  const entry = paths.get(id);
  return entry?.done ? entry.path : null;
}

/** Downloaded from a site on the dangerous-sites lists: never opened directly, only shown in its folder. */
export function isDangerousDownload(id: string): boolean {
  return paths.get(id)?.dangerous ?? false;
}

export function getDownloadPath(id: string): string | null {
  return paths.get(id)?.path ?? null;
}
