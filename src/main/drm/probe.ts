import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { DRM_PROBE_SCHEME } from './probe-scheme';

/** One local, hidden, sandboxed CDM instantiation. No media, identifiers, licenses or remote requests. */
export async function probeWidevine(): Promise<boolean> {
  const isolated = session.fromPartition(`drm-probe-${randomUUID()}`);
  let win: BrowserWindow | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    await isolated.protocol.handle(DRM_PROBE_SCHEME, () => new Response('<!doctype html><title>DRM check</title>', {
      headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; script-src 'none'" },
    }));
    win = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const window = win;
    const check = async (): Promise<boolean> => {
      await window.loadURL(`${DRM_PROBE_SCHEME}://check/`);
      return await window.webContents.executeJavaScript(`(async () => {
        if (!isSecureContext || typeof navigator.requestMediaKeySystemAccess !== 'function') return false;
        const base = { distinctiveIdentifier: 'not-allowed', persistentState: 'not-allowed', sessionTypes: ['temporary'] };
        try {
          const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
            { ...base, initDataTypes: ['cenc'], videoCapabilities: [{contentType: 'video/mp4; codecs="avc1.42E01E"'}] },
            { ...base, initDataTypes: ['webm'], videoCapabilities: [{contentType: 'video/webm; codecs="vp8"'}] }
          ]);
          await access.createMediaKeys();
          return true;
        } catch { return false; }
      })()`) === true;
    };
    return await Promise.race([check(), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 8000); })]);
  } catch { return false; }
  finally {
    if (timer) clearTimeout(timer);
    if (win && !win.isDestroyed()) win.destroy();
    isolated.protocol.unhandle(DRM_PROBE_SCHEME);
  }
}
