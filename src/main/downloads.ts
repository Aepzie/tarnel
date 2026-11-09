import { app, type DownloadItem, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { IPC } from '../shared/ipc';
import type { DownloadState } from '../shared/types';
import { sendToChrome } from './window';

const EMIT_INTERVAL_MS = 250;
const attached = new WeakSet<Session>();
const paths = new Map<string, { path: string; done: boolean }>();
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

export function attachDownloads(session: Session): void {
  if (attached.has(session)) return;
  attached.add(session);
  session.on('will-download', (_event, item) => {
    const path = uniquePath(app.getPath('downloads'), item.getFilename());
    item.setSavePath(path);
    reserved.add(path);
    const id = randomUUID();
    paths.set(id, { path, done: false });

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
      sendToChrome(IPC.chromeEvents.download, snapshot(id, item, path, state));
    });
  });
}

/** Path of a completed download (for opening), or null. */
export function getCompletedDownloadPath(id: string): string | null {
  const entry = paths.get(id);
  return entry?.done ? entry.path : null;
}

export function getDownloadPath(id: string): string | null {
  return paths.get(id)?.path ?? null;
}
