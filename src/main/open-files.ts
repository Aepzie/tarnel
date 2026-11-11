import { app } from 'electron';
import { statSync } from 'node:fs';
import { getSettings } from './settings';
import { fileUrlForPath, openTargetsFromArgs, type OpenTargetEnv, type PathKind } from './open-targets';
import { resolveInput } from './url';

/**
 * Opening local files and URLs handed to Vela by the OS: command line (startup and
 * `second-instance`), macOS `open-file` / `open-url`, and paths dropped onto the chrome UI.
 */

function localStat(path: string): PathKind {
  try {
    const stat = statSync(path);
    if (stat.isFile()) return 'file';
    return stat.isDirectory() ? 'directory' : null;
  } catch {
    return null;
  }
}

function envFor(cwd: string): OpenTargetEnv {
  return { cwd, stat: localStat, windows: process.platform === 'win32' };
}

function resolveTarget(target: string): string | null {
  return target.startsWith('file:') ? target : resolveInput(target, getSettings().searchEngine);
}

/** Tab URLs for a full argv (skips the executable and, unpackaged, the app path). */
export function urlsFromArgv(argv: readonly string[], cwd: string = process.cwd()): string[] {
  return openTargetsFromArgs(argv.slice(app.isPackaged ? 1 : 2), envFor(cwd))
    .map(resolveTarget)
    .filter((url): url is string => !!url);
}

/** file:// URL for an absolute local path that exists and is a regular file, else null. */
export function fileUrlForLocalPath(path: string): string | null {
  return fileUrlForPath(path, envFor(process.cwd()));
}

const pending: string[] = [];
let opener: ((url: string) => void) | null = null;

function deliver(url: string | null): void {
  if (!url) return;
  if (opener) opener(url);
  else pending.push(url);
}

/**
 * macOS hands files and URLs to the running app via events, not argv; they can arrive before
 * `ready` (launch by double-click), so they are queued until `startOpening` is called.
 * Must be called synchronously at startup, before `ready`.
 */
export function listenForOpenRequests(): void {
  app.on('open-file', (event, path) => {
    event.preventDefault();
    deliver(fileUrlForLocalPath(path));
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const [target] = openTargetsFromArgs([url], envFor(process.cwd()));
    deliver(target ? resolveTarget(target) : null);
  });
}

/** Opens queued (and from now on every) OS open request through `open`. */
export function startOpening(open: (url: string) => void): void {
  opener = open;
  for (const url of pending.splice(0)) open(url);
}
