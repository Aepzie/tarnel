/**
 * Ghostery's Electron integration runs every cosmetic scriptlet for a page as its own top-level
 * classic script (`webContents.executeJavaScript`) in the page's main world. Each uBO scriptlet
 * bundles its helpers (`safeSelf`, `proxyApplyFn`, `class JSONPath`, ...) as top-level
 * declarations, so ~30 YouTube scriptlets share one global scope: a later scriptlet redefines the
 * helpers an earlier one already wired into `JSON.parse` / `fetch` / XHR, the `class JSONPath`
 * ones abort with "Identifier 'JSONPath' has already been declared", and the proxied page
 * functions end in "Maximum call stack size exceeded". On YouTube that left the player without a
 * video (black, never loading) on part of the loads.
 *
 * uBO itself gives every scriptlet its own function scope. Doing the same here keeps each
 * scriptlet's helpers private; the catch keeps a failing scriptlet from rejecting in main.
 */
export function isolateScriptlet(source: string): string {
  return `(function () {\ntry {\n${source}\n} catch (e) {}\n})();`;
}
