/**
 * Default browser (Settings → General). Pure — no Electron imports, so the status mapping and the
 * Windows deep link are unit-tested (default-browser.test.ts) and the types are shared with the
 * settings page. The main-process side is src/main/default-browser.ts; the Windows registry entries
 * it relies on are written by build/installer.nsh.
 */

export const DEFAULT_BROWSER_IPC = {
  status: 'pages:default-browser-status',
  makeDefault: 'pages:default-browser-make-default',
} as const;

/** Value name under `Software\RegisteredApplications` (build/installer.nsh). */
export const REGISTERED_APP_NAME = 'Vela';

/**
 * - `ready`: the button can do something.
 * - `dev`: unpackaged run — would register the dev electron.exe, so it is refused.
 * - `portable`: Windows portable exe — nothing is registered, Windows can't list it.
 * - `unsupported`: a platform without a default-browser concept Electron can set.
 */
export type DefaultBrowserSupport = 'ready' | 'dev' | 'portable' | 'unsupported';

/** `settings`: Windows only lets the user choose, so "Make default" opens Default apps. */
export type DefaultBrowserMethod = 'settings' | 'direct';

export interface DefaultBrowserStatus {
  isDefault: boolean;
  support: DefaultBrowserSupport;
  method: DefaultBrowserMethod;
}

/** `opened-settings`: Windows Default apps was opened; the status changes once the user picks Vela. */
export type MakeDefaultResult = 'opened-settings' | 'done' | 'not-supported';

export interface DefaultBrowserEnv {
  platform: string;
  packaged: boolean;
  /** Set by the electron-builder portable launcher (PORTABLE_EXECUTABLE_DIR). */
  portable: boolean;
}

export function defaultBrowserSupport(env: DefaultBrowserEnv): DefaultBrowserSupport {
  if (env.platform !== 'win32' && env.platform !== 'darwin' && env.platform !== 'linux') return 'unsupported';
  if (!env.packaged) return 'dev';
  if (env.platform === 'win32' && env.portable) return 'portable';
  return 'ready';
}

export function defaultBrowserMethod(platform: string): DefaultBrowserMethod {
  return platform === 'win32' ? 'settings' : 'direct';
}

/** Default for the web only when both schemes go to Vela (a split setup isn't "default"). */
export function isDefaultForBoth(http: boolean, https: boolean): boolean {
  return http && https;
}

function normalizeWindowsPath(path: string): string {
  return path.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase();
}

/** Windows: the handler path Windows reports for a scheme vs. our executable (case-insensitive). */
export function isSameExecutable(handlerPath: string | null | undefined, execPath: string): boolean {
  if (!handlerPath) return false;
  return normalizeWindowsPath(handlerPath) === normalizeWindowsPath(execPath);
}

/**
 * Per-user installs register under HKCU (`registeredAppUser`), "all users" installs under HKLM
 * (`registeredAppMachine`); the link opens Vela's own page in Settings → Default apps.
 */
export function defaultAppsDeepLink(scope: 'user' | 'machine', appName: string = REGISTERED_APP_NAME): string {
  const key = scope === 'machine' ? 'registeredAppMachine' : 'registeredAppUser';
  return `ms-settings:defaultapps?${key}=${encodeURIComponent(appName)}`;
}

/** An "all users" install lives under Program Files (assisted installer choice). */
export function installScope(execPath: string, programFilesDirs: readonly (string | undefined)[]): 'user' | 'machine' {
  const exe = normalizeWindowsPath(execPath);
  const machine = programFilesDirs.some((dir) => {
    if (!dir) return false;
    const base = normalizeWindowsPath(dir).replace(/\\+$/, '');
    return base.length > 0 && exe.startsWith(`${base}\\`);
  });
  return machine ? 'machine' : 'user';
}
