import { posix, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Turning command-line arguments ("Open with", double-click, `vela.exe C:\file.pdf`, macOS
 * `open-file`) and dropped paths into tab URLs. Pure: the file system is injected, so this has no
 * Electron or fs dependency and is unit-tested on both Windows and POSIX path rules.
 */

export type PathKind = 'file' | 'directory' | null;

export interface OpenTargetEnv {
  /** Working directory relative paths resolve against (the second instance's cwd). */
  cwd: string;
  /** 'file', 'directory' or null (missing / unreadable). */
  stat: (path: string) => PathKind;
  windows: boolean;
}

/** Schemes passed through to the address-bar resolver as is. */
const URL_ARG = /^(https?:|vela:)/i;
const FILE_URL = /^file:/i;
const WINDOWS_DRIVE = /^[a-z]:([\\/]|$)/i;
const MAX_ARG = 32_768;

/**
 * file:// URL for a local path, or null when the path does not exist or is not a regular file.
 * Directories are ignored on purpose: Chromium's directory listing is a dead end in a browser
 * tab and a stray `.` (the app path in development) must not open a tab.
 */
export function fileUrlForPath(raw: string, env: OpenTargetEnv): string | null {
  if (!raw || raw.length > MAX_ARG || raw.includes('\0')) return null;
  const path = env.windows ? win32 : posix;
  const absolute = path.resolve(env.cwd, raw);
  if (env.stat(absolute) !== 'file') return null;
  return pathToFileURL(absolute, { windows: env.windows }).href;
}

function pathFromFileUrl(arg: string, windows: boolean): string | null {
  try {
    return fileURLToPath(arg, { windows });
  } catch {
    return null;
  }
}

/**
 * Tab URLs for command-line arguments, in order. `args` must already exclude the executable (and the
 * app path in development). Flags (`-x`, `--foo`, `--foo=bar`, Chromium switches) are skipped;
 * http(s)/vela URLs are returned unchanged for the caller to resolve; everything else is treated as
 * a local path (absolute, relative to `env.cwd`, or a file:// URL) and kept only if it exists.
 */
export function openTargetsFromArgs(args: readonly string[], env: OpenTargetEnv): string[] {
  const out: string[] = [];
  for (const raw of args) {
    if (typeof raw !== 'string') continue;
    const arg = raw.trim();
    if (!arg || arg.startsWith('-')) continue;
    if (URL_ARG.test(arg)) {
      out.push(arg);
      continue;
    }
    const local = FILE_URL.test(arg) && !(env.windows && WINDOWS_DRIVE.test(arg)) ? pathFromFileUrl(arg, env.windows) : arg;
    const url = local ? fileUrlForPath(local, env) : null;
    if (url) out.push(url);
  }
  return out;
}

/** True for the file:// URLs `fileUrlForPath` produces (used to validate dropped/argv targets). */
export function isFileUrl(url: string): boolean {
  return FILE_URL.test(url);
}
