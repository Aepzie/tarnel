import { contextBridge, ipcRenderer } from 'electron';
import { FINGERPRINT_WORKER_CONFIG_CHANNEL, type FingerprintConfig } from '../shared/fingerprint';
import { protectMainWorld } from './fingerprint-main-world';

/**
 * Service-worker session preload, registered only for Spaces whose fingerprint protection is on.
 * Runs before the worker script and patches the worker's global scope with the window's patch
 * (keyed by the worker's scope site). The preload realm has no `self` / `location`: main reads the
 * scope from the ServiceWorkerMain that sent the request.
 */
function readConfig(): FingerprintConfig | null {
  try {
    return ipcRenderer.sendSync(FINGERPRINT_WORKER_CONFIG_CHANNEL) as FingerprintConfig | null;
  } catch {
    return null;
  }
}

const config = readConfig();
if (config) {
  try {
    contextBridge.executeInMainWorld({ func: protectMainWorld, args: [config] });
  } catch {
    /* never break the worker */
  }
}
