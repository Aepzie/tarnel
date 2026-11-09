import { contextBridge, ipcRenderer } from 'electron';
import { FINGERPRINT_CONFIG_CHANNEL, type FingerprintConfig } from '../shared/fingerprint';
import { protectMainWorld } from './fingerprint-main-world';

/**
 * Session-level preload, registered only for Spaces whose fingerprint protection is on. Runs in
 * every frame (sandboxed) before any page script and patches the page's main world synchronously.
 */
function readConfig(): FingerprintConfig | null {
  try {
    return ipcRenderer.sendSync(FINGERPRINT_CONFIG_CHANNEL, location.href) as FingerprintConfig | null;
  } catch {
    return null;
  }
}

const config = readConfig();
if (config) {
  try {
    contextBridge.executeInMainWorld({ func: protectMainWorld, args: [config] });
  } catch {
    /* never break the page */
  }
}
