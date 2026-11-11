import { app, shell, type IpcMainInvokeEvent } from 'electron';
import {
  DEFAULT_BROWSER_IPC,
  defaultAppsDeepLink,
  defaultBrowserMethod,
  defaultBrowserSupport,
  installScope,
  isDefaultForBoth,
  isSameExecutable,
  type DefaultBrowserStatus,
  type MakeDefaultResult,
} from '../shared/default-browser';

/**
 * Settings → General → Default browser. Only on demand (no timers): the settings page asks for the
 * status on load and when it regains focus.
 *
 * Windows 10/11 don't let apps make themselves the default; the installer registers Vela
 * (build/installer.nsh) and "Make default" opens Vela's page in Settings → Default apps. The status
 * comes from the handler Windows actually uses (UserChoice), not from `isDefaultProtocolClient`,
 * which only reads `HKCU\Software\Classes\<scheme>` and misses the Settings choice.
 * macOS/Linux: Electron's protocol client API sets it directly.
 */

function env() {
  return { platform: process.platform, packaged: app.isPackaged, portable: !!process.env.PORTABLE_EXECUTABLE_DIR };
}

async function windowsHandlesScheme(scheme: 'http' | 'https'): Promise<boolean> {
  try {
    const handler = await app.getApplicationInfoForProtocol(`${scheme}://example.com/`);
    return isSameExecutable(handler.path, process.execPath);
  } catch {
    return false;
  }
}

async function isDefault(): Promise<boolean> {
  if (process.platform === 'win32') {
    const [http, https] = await Promise.all([windowsHandlesScheme('http'), windowsHandlesScheme('https')]);
    return isDefaultForBoth(http, https);
  }
  return isDefaultForBoth(app.isDefaultProtocolClient('http'), app.isDefaultProtocolClient('https'));
}

export async function getDefaultBrowserStatus(): Promise<DefaultBrowserStatus> {
  const current = env();
  return {
    isDefault: await isDefault(),
    support: defaultBrowserSupport(current),
    method: defaultBrowserMethod(current.platform),
  };
}

export async function makeDefaultBrowser(): Promise<MakeDefaultResult> {
  const current = env();
  if (defaultBrowserSupport(current) !== 'ready') return 'not-supported';
  if (current.platform === 'win32') {
    const scope = installScope(process.execPath, [process.env.ProgramFiles, process.env.ProgramW6432, process.env['ProgramFiles(x86)']]);
    await shell.openExternal(defaultAppsDeepLink(scope));
    return 'opened-settings';
  }
  const http = app.setAsDefaultProtocolClient('http');
  const https = app.setAsDefaultProtocolClient('https');
  return http && https ? 'done' : 'not-supported';
}

function fromSettingsPage(event: IpcMainInvokeEvent): boolean {
  try {
    return new URL(event.senderFrame?.url ?? '').host === 'settings';
  } catch {
    return false;
  }
}

type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

export function registerDefaultBrowserIpc(handlePages: PagesHandler): void {
  handlePages(DEFAULT_BROWSER_IPC.status, (event) => {
    if (!fromSettingsPage(event)) throw new Error('Forbidden');
    return getDefaultBrowserStatus();
  });
  handlePages(DEFAULT_BROWSER_IPC.makeDefault, (event) => {
    if (!fromSettingsPage(event)) throw new Error('Forbidden');
    return makeDefaultBrowser();
  });
}
