import { randomBytes } from 'node:crypto';
import { watch as watchDir } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Name of the directory Vela creates inside the user's folder / WebDAV collection. */
export const SYNC_DIR = 'vela-sync';
/** Only these names are ever read, written or deleted at the remote. */
export const KEY_FILE = 'key.json';
export const DEVICE_FILE = /^dev-([0-9a-f]{16})\.vsync$/;

export interface RemoteFile {
  name: string;
  /** Opaque change marker (mtime+size, ETag …); unchanged files are not re-downloaded. */
  version: string;
}

export interface Transport {
  readonly label: string;
  /** Creates the sync directory when missing. */
  ensure(): Promise<void>;
  list(): Promise<RemoteFile[]>;
  read(name: string): Promise<Buffer | null>;
  write(name: string, contents: Buffer): Promise<void>;
  remove(name: string): Promise<void>;
  /** Optional change notifications (folder only); returns an unsubscribe. */
  watch?(onChange: (name: string) => void): () => void;
}

function isOurs(name: string): boolean {
  return name === KEY_FILE || DEVICE_FILE.test(name);
}

function assertOurs(name: string): void {
  if (!isOurs(name)) throw new Error(`Refusing to touch ${name}`);
}

// ---------------------------------------------------------------------------
// folder (OneDrive, Dropbox, iCloud Drive, Syncthing … or any local/network folder)

export function folderTransport(root: string): Transport {
  const dir = path.join(root, SYNC_DIR);
  return {
    label: root,
    async ensure() {
      const stat = await fs.stat(root).catch(() => null);
      if (!stat?.isDirectory()) throw new Error('The sync folder does not exist');
      await fs.mkdir(dir, { recursive: true });
    },
    async list() {
      const names = await fs.readdir(dir).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return [] as string[];
        throw err;
      });
      const files: RemoteFile[] = [];
      for (const name of names.filter(isOurs)) {
        const stat = await fs.stat(path.join(dir, name)).catch(() => null);
        if (stat?.isFile()) files.push({ name, version: `${stat.mtimeMs}:${stat.size}` });
      }
      return files;
    },
    async read(name) {
      assertOurs(name);
      return fs.readFile(path.join(dir, name)).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });
    },
    async write(name, contents) {
      assertOurs(name);
      // Write next to the target, then rename: sync clients never upload a half-written file.
      const tmp = path.join(dir, `.${name}.${randomBytes(4).toString('hex')}.tmp`);
      await fs.writeFile(tmp, contents);
      try {
        await fs.rename(tmp, path.join(dir, name));
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
    },
    async remove(name) {
      assertOurs(name);
      await fs.rm(path.join(dir, name), { force: true });
    },
    watch(onChange) {
      try {
        const watcher = watchDir(dir, { persistent: false }, (_event, name) => {
          if (typeof name === 'string' && isOurs(name)) onChange(name);
        });
        watcher.on('error', () => watcher.close());
        return () => watcher.close();
      } catch {
        return () => undefined;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// WebDAV (Nextcloud, ownCloud, Fastmail files, any RFC 4918 server)

const TIMEOUT_MS = 30_000;

/** https only; plain http is allowed for loopback (local test servers) and nothing else. */
export function normalizeWebdavUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Enter a valid WebDAV URL');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('WebDAV must use https://');
  if (url.username || url.password) throw new Error('Put the username and password in their own fields, not in the URL');
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** Minimal PROPFIND multistatus parsing: href + getetag/getlastmodified/getcontentlength per response. */
export function parseMultistatus(xml: string): { href: string; version: string }[] {
  const out: { href: string; version: string }[] = [];
  const responses = xml.split(/<(?:[\w-]+:)?response[\s>]/i).slice(1);
  for (const block of responses) {
    const pick = (tag: string): string => {
      const match = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i').exec(block);
      return match ? decodeXml(match[1]!.trim()) : '';
    };
    const href = pick('href');
    if (!href) continue;
    out.push({ href, version: [pick('getetag'), pick('getlastmodified'), pick('getcontentlength')].join('|') });
  }
  return out;
}

export function webdavTransport(rawUrl: string, username: string, password: string): Transport {
  const base = new URL(`${SYNC_DIR}/`, normalizeWebdavUrl(rawUrl));
  const auth = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

  const request = async (method: string, target: URL, init: { headers?: Record<string, string>; body?: Buffer | string } = {}): Promise<Response> => {
    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers: { Authorization: auth, ...init.headers },
        body: typeof init.body === 'string' || init.body === undefined ? init.body : new Uint8Array(init.body),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'is unreachable';
      throw new Error(`The WebDAV server ${reason}`);
    }
    if (response.status === 401 || response.status === 403) throw new Error('WebDAV rejected the username or app password');
    return response;
  };

  const fail = (what: string, response: Response): Error => new Error(`WebDAV ${what} failed (HTTP ${response.status})`);
  const fileUrl = (name: string): URL => {
    assertOurs(name);
    return new URL(encodeURIComponent(name), base);
  };

  return {
    label: `${base.host}${decodeURIComponent(new URL('..', base).pathname)}`,
    async ensure() {
      const probe = await request('PROPFIND', base, { headers: { Depth: '0' } });
      await probe.body?.cancel();
      if (probe.ok || probe.status === 207) return;
      if (probe.status !== 404) throw fail('lookup', probe);
      const created = await request('MKCOL', base);
      await created.body?.cancel();
      if (!created.ok && created.status !== 405) throw fail('folder creation', created);
    },
    async list() {
      const response = await request('PROPFIND', base, {
        headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
        body:
          '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>',
      });
      if (response.status === 404) return [];
      if (response.status !== 207 && !response.ok) throw fail('listing', response);
      const files: RemoteFile[] = [];
      for (const entry of parseMultistatus(await response.text())) {
        const segments = new URL(entry.href, base).pathname.split('/').filter(Boolean);
        const name = decodeURIComponent(segments[segments.length - 1] ?? '');
        if (isOurs(name)) files.push({ name, version: entry.version });
      }
      return files;
    },
    async read(name) {
      const response = await request('GET', fileUrl(name));
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw fail('download', response);
      return Buffer.from(await response.arrayBuffer());
    },
    async write(name, contents) {
      const response = await request('PUT', fileUrl(name), { headers: { 'Content-Type': 'application/octet-stream' }, body: contents });
      await response.body?.cancel();
      if (!response.ok) throw fail('upload', response);
    },
    async remove(name) {
      const response = await request('DELETE', fileUrl(name));
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw fail('delete', response);
    },
  };
}
