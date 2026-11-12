import { ipcRenderer, webFrame } from 'electron';
import { ADBLOCK_EARLY_CHANNEL } from '../shared/adblock-early';

/**
 * Session preload, registered only while ad blocking is on (src/main/perf/adblock-early.ts). Runs
 * in every web frame before any page script: fetches the frame's scriptlets synchronously and runs
 * them in the page's main world, so they are in place when the page's first inline script runs.
 */

function scriptlets(): string[] {
  try {
    const scripts: unknown = ipcRenderer.sendSync(ADBLOCK_EARLY_CHANNEL, location.href);
    return Array.isArray(scripts) ? scripts.filter((code): code is string => typeof code === 'string') : [];
  } catch {
    return [];
  }
}

if (location.protocol === 'https:' || location.protocol === 'http:') {
  for (const code of scriptlets()) {
    webFrame.executeJavaScript(code).catch(() => undefined);
  }
}
