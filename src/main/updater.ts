import { app, type WebContents } from 'electron';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import { IPC } from '../shared/ipc';
import type { Settings, UpdateMode, UpdateNotifyReason, UpdateStatus } from '../shared/types';
import { getSettings, onSettingsChanged } from './settings';
import { createTab } from './tabs';
import { sendToChrome } from './window';

/**
 * Auto-update via electron-updater (GitHub releases). The library is only `require`d on the first
 * check, so a disabled updater (dev runs, setting off) costs nothing at startup.
 *
 * Installable builds (NSIS, AppImage, Developer-ID-signed macOS) download in the background and
 * install on quit or on "Restart". Portable, unsigned macOS and deb builds only notify and link
 * the release page. `VELA_UPDATE_FEED=<url|dir>` points the updater at a generic feed for testing.
 */

const STARTUP_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PROGRESS_THROTTLE_MS = 250;
const MAX_NOTES = 20_000;
const RELEASES_URL = 'https://github.com/Aepzie/tarnel/releases';
const FEED_OVERRIDE = process.env.VELA_UPDATE_FEED?.trim() ?? '';

export interface UpdaterDeps {
  /** Persist session + stores synchronously before the installer takes over. */
  beforeInstall(): void;
}

let deps: UpdaterDeps | null = null;
let status: UpdateStatus = { mode: 'disabled', phase: 'idle', currentVersion: app.getVersion() };
let updater: AppUpdater | null = null;
let loading: Promise<AppUpdater> | null = null;
let checking: Promise<void> | null = null;
let startupTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let lastProgressAt = 0;
const watchers = new Set<WebContents>();

function initialMode(): { mode: UpdateMode; reason?: UpdateNotifyReason } {
  if (!app.isPackaged) return FEED_OVERRIDE ? { mode: 'notify', reason: 'dev' } : { mode: 'disabled', reason: 'dev' };
  if (process.platform === 'win32') {
    return process.env.PORTABLE_EXECUTABLE_DIR ? { mode: 'notify', reason: 'portable' } : { mode: 'install' };
  }
  if (process.platform === 'darwin') return { mode: 'notify', reason: 'mac-unsigned' };
  return process.env.APPIMAGE ? { mode: 'install' } : { mode: 'notify', reason: 'linux-package' };
}

/** Squirrel.Mac refuses to update apps without a Developer ID signature; ad-hoc signed builds only notify. */
function isDeveloperIdSigned(): Promise<boolean> {
  const bundle = resolve(process.execPath, '..', '..', '..');
  return new Promise((done) => {
    execFile('codesign', ['-dv', '--verbose=2', bundle], { timeout: 5000 }, (_error, stdout, stderr) => {
      done(/Authority=Developer ID Application/.test(`${stdout}${stderr}`));
    });
  });
}

function publish(): void {
  sendToChrome(IPC.chromeEvents.update, status);
  for (const wc of watchers) {
    if (wc.isDestroyed() || !wc.getURL().startsWith('tarnel://')) {
      watchers.delete(wc);
      continue;
    }
    wc.send(IPC.pagesEvents.update, status);
  }
}

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch };
  publish();
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/net::ERR_|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|getaddrinfo/i.test(raw)) {
    return 'Couldn’t reach the update server.';
  }
  if (/ERR_UPDATER_LATEST_VERSION_NOT_FOUND|Unable to find latest version/i.test(raw)) return 'No published release found.';
  if (/ERR_UPDATER_INVALID_SIGNATURE/.test(raw)) return 'The downloaded update failed signature verification.';
  if (/sha512 checksum mismatch/i.test(raw)) return 'The downloaded update was corrupted. Try again.';
  const firstLine = raw.split('\n')[0]?.trim() ?? '';
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine || 'Update failed.';
}

function fail(error: unknown): void {
  setStatus({ phase: 'error', error: errorMessage(error), percent: undefined, bytesPerSecond: undefined });
}

function notesOf(info: UpdateInfo): string | undefined {
  const notes = info.releaseNotes;
  if (!notes) return undefined;
  const text = typeof notes === 'string' ? notes : notes.map((entry) => `## ${entry.version}\n\n${entry.note ?? ''}`).join('\n\n');
  return text.length > MAX_NOTES ? `${text.slice(0, MAX_NOTES)}…` : text;
}

function infoPatch(info: UpdateInfo): Partial<UpdateStatus> {
  return {
    version: info.version,
    releaseName: info.releaseName ?? undefined,
    releaseNotes: notesOf(info),
    releaseDate: info.releaseDate,
    releaseUrl: FEED_OVERRIDE ? RELEASES_URL : `${RELEASES_URL}/tag/v${info.version}`,
  };
}

/** Serves a local directory as a generic update feed (dev/testing only). */
async function localFeedUrl(dir: string): Promise<string> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname).replace(/^\/+/, '');
    const file = resolve(root, name);
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    stat(file).then(
      (info) => {
        if (!info.isFile()) throw new Error('not a file');
        res.writeHead(200, { 'Content-Length': info.size, 'Content-Type': 'application/octet-stream' });
        if (req.method === 'HEAD') res.end();
        else createReadStream(file).pipe(res);
      },
      () => res.writeHead(404).end(),
    ).catch(() => res.writeHead(404).end());
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  server.unref();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}/`;
}

async function loadUpdater(): Promise<AppUpdater> {
  if (process.platform === 'darwin' && app.isPackaged && (await isDeveloperIdSigned())) {
    setStatus({ mode: 'install', reason: undefined });
  }
  // Plain require (kept external by esbuild): loaded from app.asar only when the first check runs.
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  autoUpdater.logger = { info: () => undefined, warn: () => undefined, error: (message: unknown) => console.error('[tarnel] updater', message) };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = status.mode === 'install';
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = getSettings().updatePrerelease;
  autoUpdater.disableWebInstaller = true;
  if (FEED_OVERRIDE) {
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
    const url = /^https?:\/\//i.test(FEED_OVERRIDE) ? FEED_OVERRIDE : await localFeedUrl(FEED_OVERRIDE);
    autoUpdater.setFeedURL({ provider: 'generic', url });
  }

  autoUpdater.on('update-available', (info: UpdateInfo) => setStatus({ phase: 'available', error: undefined, ...infoPatch(info) }));
  autoUpdater.on('update-not-available', () =>
    setStatus({ phase: 'up-to-date', error: undefined, version: undefined, releaseNotes: undefined, releaseName: undefined }),
  );
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
    lastProgressAt = now;
    setStatus({ phase: 'downloading', percent: progress.percent, bytesPerSecond: progress.bytesPerSecond });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    setStatus({ phase: 'ready', percent: 100, bytesPerSecond: undefined, error: undefined, ...infoPatch(info) }),
  );
  autoUpdater.on('error', () => undefined);
  updater = autoUpdater;
  return autoUpdater;
}

function ensureUpdater(): Promise<AppUpdater> {
  loading ??= loadUpdater().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export async function downloadUpdate(manual = true): Promise<void> {
  if (status.mode !== 'install' || !updater || !status.version) return;
  if (status.phase !== 'available' && status.phase !== 'error') return;
  setStatus({ phase: 'downloading', percent: 0, bytesPerSecond: undefined, manual, error: undefined });
  try {
    await updater.downloadUpdate();
  } catch (error) {
    fail(error);
  }
}

export function checkForUpdates(): Promise<void> {
  if (status.mode === 'disabled' || status.phase === 'downloading' || status.phase === 'ready') return Promise.resolve();
  checking ??= (async () => {
    try {
      const instance = await ensureUpdater();
      setStatus({ phase: 'checking', error: undefined });
      const result = await instance.checkForUpdates();
      if (!result?.isUpdateAvailable && status.phase === 'checking') setStatus({ phase: 'up-to-date' });
      if (result?.isUpdateAvailable && status.mode === 'install' && getSettings().updateAutoDownload) {
        void downloadUpdate(false);
      }
    } catch (error) {
      fail(error);
    } finally {
      checking = null;
      setStatus({ checkedAt: Date.now() });
    }
  })();
  return checking;
}

export function installUpdate(): void {
  if (status.mode !== 'install' || status.phase !== 'ready' || !updater) return;
  try {
    deps?.beforeInstall();
  } catch {
    /* installing must not depend on a successful flush */
  }
  updater.quitAndInstall(true, true);
}

export function openReleasePage(): void {
  createTab({ url: status.releaseUrl ?? RELEASES_URL, active: true });
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

/** Push status changes to a tarnel:// page (settings) until it navigates away or closes. */
export function watchUpdates(wc: WebContents): void {
  if (watchers.has(wc)) return;
  watchers.add(wc);
  wc.once('destroyed', () => watchers.delete(wc));
}

function schedule(enabled: boolean): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = intervalTimer = null;
  if (!enabled || status.mode === 'disabled') return;
  startupTimer = setTimeout(() => void checkForUpdates(), STARTUP_DELAY_MS);
  intervalTimer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
  startupTimer.unref();
  intervalTimer.unref();
}

export function initUpdater(input: UpdaterDeps): void {
  deps = input;
  status = { ...status, ...initialMode() };
  let previous: Settings = getSettings();
  schedule(previous.updateAutoCheck);
  onSettingsChanged((next) => {
    if (next.updateAutoCheck !== previous.updateAutoCheck) schedule(next.updateAutoCheck);
    if (updater && next.updatePrerelease !== previous.updatePrerelease) updater.allowPrerelease = next.updatePrerelease;
    if (next.updateAutoDownload && !previous.updateAutoDownload && status.phase === 'available') void downloadUpdate(false);
    previous = next;
  });
}

export function stopUpdater(): void {
  schedule(false);
}
