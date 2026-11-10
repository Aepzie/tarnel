import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const MAX_DB_BYTES = 1024 * 1024 * 1024;

/**
 * Runs `read` against a private copy of another browser's SQLite file. The source is never opened:
 * the running browser may hold a lock on it, and Vela must not change it. A pending -wal journal is
 * copied too so recent changes are included; the copy is opened read-only and deleted afterwards.
 * node:sqlite ships with Electron's Node (24.x) and is loaded lazily, only when an import runs.
 */
export async function withDatabaseCopy<T>(source: string, read: (db: DatabaseSync) => T): Promise<T> {
  const info = await stat(source);
  if (!info.isFile() || info.size > MAX_DB_BYTES) throw new Error('The browser database is missing or too large.');
  const dir = await mkdtemp(join(tmpdir(), 'vela-import-'));
  const copy = join(dir, basename(source));
  try {
    await copyFile(source, copy);
    await copyFile(`${source}-wal`, `${copy}-wal`).catch(() => undefined);
    const { DatabaseSync: Database } = await import('node:sqlite');
    const open = (readOnly: boolean): DatabaseSync => {
      const handle = new Database(copy, { readOnly });
      try {
        handle.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();
        return handle;
      } catch (error) {
        handle.close();
        throw error;
      }
    };
    let db: DatabaseSync;
    try {
      db = open(true);
    } catch {
      // A copied WAL journal can need a writable -shm; this is our private copy, so open it normally.
      db = open(false);
    }
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
