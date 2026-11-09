import { contextBridge } from 'electron';
import { reportIdentityHints } from './identity-hints';
import { shapeMainWorld } from './identity-main-world';

/**
 * Session-level preload for every Space (fingerprint protection on or off). Runs in every frame
 * (sandboxed) before page scripts and gives web pages the `window.chrome` shape of a Chromium
 * browser. The top frame also reports the client hints to main, in case the chrome UI could not.
 */
/** By origin, not URL: about:srcdoc / about:blank documents inherit their web parent's origin. */
const isWebPage = /^https?:\/\//.test(self.origin);

if (isWebPage) {
  try {
    contextBridge.executeInMainWorld({ func: shapeMainWorld });
  } catch {
    /* never break the page */
  }
  if (window === window.top) reportIdentityHints();
}
