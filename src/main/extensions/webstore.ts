import { app, net } from 'electron';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { EXTENSION_ID } from './registry';

/**
 * Chrome Web Store downloads (signed CRX from Google's update service, unpacked to
 * userData/Extensions/<id>/<version>_0) and update checks. `electron-chrome-web-store` is only
 * imported when something is actually downloaded.
 */

const UPDATE_URL = 'https://update.googleapis.com/service/update2/json';

/** Lazy CommonJS require (external in the bundle). */
const webStore = (): typeof import('electron-chrome-web-store') =>
  require('electron-chrome-web-store') as typeof import('electron-chrome-web-store');

export function extensionsDir(): string {
  return join(app.getPath('userData'), 'Extensions');
}

/** Accepts a bare 32-letter ID or any chromewebstore.google.com / chrome.google.com/webstore URL. */
export function parseStoreInput(input: string): string | null {
  const value = input.trim();
  if (EXTENSION_ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (host !== 'chromewebstore.google.com' && host !== 'chrome.google.com')) return null;
  const id = url.pathname.split('/').find((part) => EXTENSION_ID.test(part));
  return id ?? null;
}

/** Only ever delete inside userData/Extensions. */
export async function removeStoreFiles(path: string): Promise<void> {
  const root = resolve(extensionsDir());
  const target = resolve(path);
  if (!target.startsWith(root + sep)) return;
  await rm(target, { recursive: true, force: true }).catch(() => undefined);
}

export async function downloadFromStore(id: string): Promise<string> {
  const { downloadExtension } = webStore();
  await removeStoreFiles(join(extensionsDir(), id));
  try {
    return await downloadExtension(id, extensionsDir());
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/Invalid CRX|Failed to download/i.test(message)) throw new Error('Not found in the Chrome Web Store');
    throw new Error(message || 'Download failed');
  }
}

/** Download a newer version next to the current one; the caller swaps and deletes the old dir. */
export async function downloadUpdate(id: string, currentPath: string): Promise<string> {
  const { downloadExtension } = webStore();
  const next = await downloadExtension(id, extensionsDir());
  if (resolve(dirname(next)) !== resolve(dirname(currentPath))) throw new Error('Unexpected update location');
  return next;
}

function newer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}

interface OmahaApp {
  appid?: string;
  updatecheck?: { status?: string; manifest?: { version?: string } };
}

/** Ask Google's update service (Omaha) which installed versions are outdated. */
export async function findUpdates(installed: { id: string; version: string }[]): Promise<string[]> {
  if (installed.length === 0) return [];
  const chrome = process.versions.chrome ?? '';
  const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : process.platform;
  const arch = process.arch === 'ia32' ? 'x86' : process.arch;
  const response = await net.fetch(UPDATE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Update-Interactivity': 'bg',
      'X-Goog-Update-AppId': installed.map((entry) => entry.id).join(','),
      'X-Goog-Update-Updater': `chromiumcrx-${chrome}`,
    },
    body: JSON.stringify({
      request: {
        '@updater': 'vela',
        acceptformat: 'crx3',
        app: installed.map((entry) => ({ appid: entry.id, updatecheck: {} })),
        os: { platform, arch },
        prodversion: chrome,
        protocol: '3.1',
        requestid: randomUUID(),
        sessionid: randomUUID(),
      },
    }),
  });
  if (!response.ok) return [];
  const body = await response.text();
  const json = body.startsWith(")]}'") ? body.slice(body.indexOf('\n') + 1) : body;
  const apps = (JSON.parse(json) as { response?: { app?: OmahaApp[] } }).response?.app ?? [];
  const current = new Map(installed.map((entry) => [entry.id, entry.version]));
  return apps
    .filter((entry) => entry.updatecheck?.status === 'ok' && typeof entry.appid === 'string')
    .filter((entry) => {
      const version = entry.updatecheck?.manifest?.version;
      const have = current.get(entry.appid!);
      return typeof version === 'string' && typeof have === 'string' && newer(version, have);
    })
    .map((entry) => entry.appid!);
}
