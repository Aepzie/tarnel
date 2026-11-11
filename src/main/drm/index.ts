import * as electron from 'electron';
import type { IpcMainInvokeEvent, Session } from 'electron';
import { DRM_IPC, type DrmStatus } from '../../shared/drm';
import type { Space } from '../../shared/types';
import { getSettings, onSettingsChanged } from '../settings';
import { addWebRequestStage } from '../net/dispatcher';
import { DrmController } from './controller';
import { detectCdmComponents } from './runtime';
import { drmLaunchPolicy, allowsDrmPermission } from './policy';
import { applyDrmLaunchSwitches } from './startup';
import { denyEncryptedMedia } from './headers';
import { probeWidevine } from './probe';

let controller: DrmController | null = null;
let startupBlocked = false;
let startupConsent = false;

/** Must run after VELA_USER_DATA is set, before ready and independently of VELA_NO_FLAGS. */
export function configureDrmStartup(): void {
  startupConsent = getSettings().drmEnabled;
  const castlabs = !!detectCdmComponents(electron);
  const policy = drmLaunchPolicy(startupConsent, castlabs, process.platform, process.arch);
  startupBlocked = applyDrmLaunchSwitches(electron.app.commandLine, policy.enabled);
}

function broadcast(status: DrmStatus): void {
  for (const wc of electron.webContents.getAllWebContents()) {
    if (!wc.isDestroyed() && isSettingsPage(wc.getURL())) wc.send(DRM_IPC.changed, status);
  }
}

export function isSettingsPage(url: string): boolean {
  try { const parsed = new URL(url); return parsed.protocol === 'vela:' && parsed.hostname === 'settings'; }
  catch { return false; }
}

export function initDrm(): void {
  controller = new DrmController({
    enabled: startupConsent, components: detectCdmComponents(electron), platform: process.platform, arch: process.arch,
    startupBlocked, probe: probeWidevine, changed: broadcast,
  });
  onSettingsChanged((settings) => controller?.setEnabled(settings.drmEnabled));
  // Does no component/probe work if off. Browser startup never waits for a download.
  void controller.start();
}

export function getDrmStatus(): DrmStatus {
  if (!controller) throw new Error('DRM status is not ready');
  return controller.status();
}

export function canUseDrm(scope: { ephemeral: boolean } | undefined, isMainFrame: boolean, requestingUrl: string | undefined, topUrl: string | undefined): boolean {
  const status = controller?.status();
  return !!scope && allowsDrmPermission({ enabled: getSettings().drmEnabled, ready: status?.state === 'available', ephemeral: scope.ephemeral, isMainFrame, requestingUrl, topUrl });
}

/** Native Permissions-Policy adds a document fence; the startup CDM gate also covers cached/local documents. */
export function attachDrmPolicy(session: Session, space: Space): void {
  addWebRequestStage(session, 'headersReceived', 'drm', 1000, (details) => {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return;
    if (!/^https?:\/\//i.test(details.url)) return;
    const allowed = !space.ephemeral && details.resourceType === 'mainFrame' && details.url.startsWith('https://') &&
      getSettings().drmEnabled && controller?.status().state === 'available';
    if (allowed) return;
    // The shared dispatcher deliberately skips throwing stages. A security policy failure must
    // instead cancel this document (e.g. a merged header beyond Chromium's parse-size limit).
    try { return { responseHeaders: denyEncryptedMedia(details.responseHeaders) }; }
    catch { return { cancel: true }; }
  });
}

export function registerDrmIpc(handlePages: (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void): void {
  handlePages(DRM_IPC.status, (event, ...args) => {
    if (!isSettingsPage(event.senderFrame?.url ?? '') || args.length !== 0) throw new Error('Forbidden DRM status request');
    return getDrmStatus();
  });
}
