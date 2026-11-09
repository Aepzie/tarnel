# Vela — Architecture

Vela is a Chromium-based desktop browser built on Electron. The browser chrome is a tiny
React + Tailwind + shadcn/ui UI ("Floating Islands", see DESIGN.md); every web page lives in its own sandboxed `WebContentsView`.

## Process & layer model

```
BaseWindow (frame: false; no webContents of its own — saves a renderer process)
└─ contentView
   ├─ chromeView   WebContentsView  full window, loads dist/renderer/chrome/index.html   (base layer)
   └─ tabView(s)   WebContentsView  only the ACTIVE tab is attached, placed at ContentBounds (top layer)
```

* The chrome UI reports where the page should go via `vela.ui.setContentBounds(rect)` (it measures a
  placeholder `<main id="viewport">` with a ResizeObserver). Main positions the active tab view there,
  with `setBorderRadius(10)`.
* When a palette / menu / dialog opens, the UI calls `vela.ui.setOverlay(true)`. Main re-adds
  `chromeView` as the last child (top). The chrome page has a transparent background where the
  viewport is, so the page stays visible under a dim backdrop. `setOverlay(false)` re-adds the active
  tab view on top again.
* Keyboard shortcuts are captured in main with `before-input-event` on **every** webContents
  (chrome + tabs) so they work regardless of focus.

## Spaces (multi-session sandboxes)

Each Space maps to its own Chromium session partition:

| Space type  | Partition                    | Lifetime                                      |
|-------------|------------------------------|-----------------------------------------------|
| persistent  | `persist:space-<id>`         | on disk, survives restarts                    |
| ephemeral   | `space-<id>` (no `persist:`) | in memory only, wiped on space removal / quit |

Cookies, localStorage, IndexedDB, cache, service workers, permissions and proxy are fully isolated
per space. Every tab belongs to exactly one space. Tabs are sandboxed (`sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`), site isolation is on.

## Fingerprint protection (per Space)

`space.fingerprint` is `'off' | 'standard' | 'strict'` (new Spaces: standard, Burners: strict). Each Space has a
random 256-bit seed (`userData/fingerprint.json`; Burner seeds live in memory, so every Burner is a new identity).
The seed never leaves main.

* **Injection** — `src/main/fingerprint/index.ts` registers `dist/preload/fingerprint.js` with
  `session.registerPreloadScript({ type: 'frame' })` on protected sessions only (`'off'` = no preload at all).
  Tab views set `nodeIntegrationInSubFrames: true` (still sandboxed, no Node) so it runs in every frame, cross-origin
  iframes included. The preload asks main synchronously (`sendSync`, sub-millisecond) for its config, then
  `contextBridge.executeInMainWorld` runs `src/preload/fingerprint-main-world.ts` in the page's main world before any
  page script. A new iframe's initial `about:blank` document gets no preload, so DOM insertions that add a frame
  patch the child realm on the spot (plus `contentWindow` / `contentDocument`).
* **Determinism** — main derives `key = HMAC(seed, top-level eTLD+1)`: stable per site across reloads and restarts,
  different per site and per Space; third-party iframes use the top-level site's key. Hardware values derive from
  the seed only (same machine across all sites of a Space).
* **Native look** — patched functions keep `name`, `length`, prototype and no `prototype` property;
  `Function.prototype.toString` returns the native source for them, also across same-origin realms.

| Surface | Standard | Strict |
|---|---|---|
| Canvas `toDataURL` / `toBlob` / `getImageData`, `OffscreenCanvas` | low-bit noise on ~1/16 of non-transparent pixels, keyed by absolute position (idempotent; blank canvases unchanged) | same |
| WebGL `readPixels` | same noise | same |
| `UNMASKED_RENDERER_WEBGL` | common model of the real GPU vendor, PCI ids stripped | same |
| `AudioBuffer.getChannelData` / `copyFromChannel`, `AnalyserNode.getFloatFrequencyData` | ±1e-6 relative noise on sparse samples (inaudible) | same |
| `measureText().width` | ±1.3e-5 relative jitter | same |
| `hardwareConcurrency`, `deviceMemory` (+ `Device-Memory` hints) | plausible bucket ≤ real | same |
| Battery API | always charging, level 1 | same |
| WebRTC IP policy | `default_public_interface_only`; `disable_non_proxied_udp` when the Space has a proxy | `disable_non_proxied_udp` |
| `screen.*` size, `colorDepth` | real | smallest common resolution ≥ real, depth 24 |
| UA client hints (JS + `Sec-CH-UA-*` headers) | real | full versions reduced to `N.0.0.0`, model empty |
| Media device labels | real | generic ("Microphone", "Camera", "Speakers") |
| `getGamepads()` | real | always empty |

**Not protected:** dedicated/shared/service workers (they see the real `hardwareConcurrency`, WebGL renderer and
unnoised `OffscreenCanvas`; wrapping workers would break module workers, relative imports and CSP), CSS media
queries (`device-width`, resolution), DOM-based font enumeration, timezone/`Intl` (left alone: spoofing breaks
calendars, banking and booking sites), the IP address itself (use a per-Space proxy). Fingerprinting test suites
(CreepJS) can still detect *that* noise is applied (pixel/audio noise, worker vs. window mismatch); what they
cannot do is link two Spaces through it. Changes apply to pages loaded afterwards.

## Directory ownership

```
src/shared/            types.ts, ipc.ts               — contracts (do not change signatures)
src/main/index.ts      bootstrap, wiring              — core
src/main/window.ts     window + layering              — core
src/main/tabs.ts       tab lifecycle                  — core
src/main/ipc.ts        ipcMain handlers + sender auth — core
src/main/shortcuts.ts  keyboard shortcuts             — core
src/main/protocol.ts   vela:// protocol               — core
src/main/downloads.ts  download handling              — core
src/main/url.ts        address-bar input resolution   — core
src/main/store.ts      JSON persistence               — data
src/main/settings.ts   settings                       — data
src/main/spaces.ts     spaces + sessions              — data
src/main/history.ts    history, suggestions, top sites— data
src/main/privacy.ts    permissions, UA, headers       — data
src/main/fingerprint/* per-space fingerprint seeds, preload registration, header hints — data
src/preload/fingerprint*.ts  main-world fingerprint patch (session preload) — data
src/main/perf/*        flags, adblock, sleeper, metrics — perf
src/preload/chrome.ts  window.vela                    — ui
src/renderer/chrome/*  top-island UI (React)          — ui
src/preload/pages.ts   window.velaPages               — pages
src/renderer/pages/*   newtab, settings, error        — pages
src/renderer/shared/   tokens.css (design tokens)
```

## Module contracts (main process)

All main modules are ES modules compiled by esbuild into one CJS bundle. Import with relative paths.

### `src/main/store.ts`
```ts
export interface JsonStore<T> { get(): T; set(next: T): void; update(fn: (current: T) => T): void; flush(): void; }
export function createStore<T>(name: string, defaults: T): JsonStore<T>; // file: userData/<name>.json, debounced atomic write (tmp + rename), 400ms
export function flushAllStores(): void; // sync flush, called on before-quit
```

### `src/main/settings.ts`
```ts
export function getSettings(): Settings;
export function updateSettings(patch: Partial<Settings>): Settings; // validates + clamps, persists, emits
export function onSettingsChanged(cb: (settings: Settings) => void): void;
```

### `src/main/spaces.ts`
```ts
export function initSpaces(): void;                       // load store, ensure ≥1 space ("Personal", blue)
export function listSpaces(): Space[];
export function getSpace(id: SpaceId): Space | undefined;
export function createSpace(input: SpaceInput): Space;
export function updateSpace(id: SpaceId, patch: Partial<SpaceInput>): Space; // ephemeral flag immutable after creation
export function removeSpace(id: SpaceId): Promise<void>;  // clears storage + cache of partition; refuses to remove last space
export function clearSpaceData(id: SpaceId): Promise<void>;
export function getActiveSpaceId(): SpaceId;
export function setActiveSpaceId(id: SpaceId): void;
export function getSpaceSession(id: SpaceId): Electron.Session; // lazy; runs all onSessionCreated hooks exactly once per session
export function onSessionCreated(hook: (session: Electron.Session, space: Space) => void): void; // also runs immediately for sessions already created
export function onSpacesChanged(cb: () => void): void;
export function disposeEphemeralSpaces(): Promise<void>;  // clear storage of ephemeral partitions (on quit)
```
`initSpaces()` itself registers `applyPrivacy` from privacy.ts via `onSessionCreated`, and applies
`space.proxy` with `session.setProxy`.

### `src/main/history.ts`
```ts
export function recordVisit(url: string, title: string): void; // skips vela://, about:, data:, ephemeral spaces handled by caller
export function suggest(input: string, limit?: number): Suggestion[]; // frecency ranking on url+title
export function topSites(limit?: number): TopSite[];
export function clearHistory(): void;
```

### `src/main/privacy.ts`
```ts
export function cleanUserAgent(ua: string): string; // strip "Electron/x.y.z" and "vela/x.y.z" tokens
export function applyPrivacy(session: Electron.Session, space: Space): void;
// - setUserAgent(cleanUserAgent(session.getUserAgent()))
// - permission request/check handlers: allow fullscreen, clipboard-sanitized-write, pointerLock,
//   media only when requested by the top frame; deny everything else by default (no prompts in v0.1)
// - onBeforeSendHeaders: DNT:1 + Sec-GPC:1 when settings.sendDoNotTrack
// - https-only: onBeforeRequest upgrade http:// main-frame navigations to https:// (except localhost/127.0.0.1/LAN)
// - third-party cookie blocking via onHeadersReceived stripping Set-Cookie on third-party sub-resources when enabled
```
NOTE: `webRequest` allows only ONE listener per event per session. Ghostery adblock uses
`onBeforeRequest` + `onHeadersReceived`. Therefore privacy.ts must NOT use `onBeforeRequest` or
`onHeadersReceived`. https-only upgrade is done in tabs.ts (`will-navigate`/URL resolution) and
privacy.ts exposes `export function upgradeToHttps(url: string): string`. Third-party cookie
blocking uses `session.cookies` + `onBeforeSendHeaders` (strip `Cookie` header on third-party
sub-resource requests) instead.

### `src/main/perf/flags.ts`
```ts
export function applyChromiumFlags(): void; // called before app 'ready'
```

### `src/main/perf/adblock.ts`
```ts
export function initAdblock(): Promise<void>;                 // load engine (cached serialized in userData, refresh in background ≥24h)
export function enableAdblockForSession(session: Electron.Session): void; // no-op until engine ready, then applies; idempotent
export function setAdblockEnabled(enabled: boolean): void;    // enable/disable in all known sessions
export function onBlocked(cb: (webContentsId: number, url: string) => void): void;
export function getBlockedTotal(): number;
```

### `src/main/perf/sleeper.ts`
```ts
export interface SleepCandidate { id: number; lastActiveAt: number; audible: boolean; pinned: boolean; asleep: boolean; active: boolean; }
export interface SleeperDeps { listTabs(): SleepCandidate[]; sleepTab(id: number): void; getSleepAfterMinutes(): number; }
export function initSleeper(deps: SleeperDeps): void; // checks every 30s; also sleeps oldest tabs under memory pressure (os.freemem < 10%)
export function stopSleeper(): void;
```

### `src/main/perf/metrics.ts`
```ts
export function collectPerfStats(input: { tabsAwake: number; tabsAsleep: number; blockedTotal: number }): PerfStats;
```

### `src/main/tabs.ts` (core, internal API used by ipc.ts / index.ts)
```ts
export function initTabs(win: Electron.BrowserWindow): void;
export function createTab(opts: { url?: string; spaceId?: SpaceId; active?: boolean; asleep?: boolean; pinned?: boolean; title?: string }): number;
export function closeTab(id: number): void;
export function activateTab(id: number): void;
export function getActiveTab(): number | null;
export function navigateTab(id: number, input: string): void;
export function sleepTab(id: number): void;
export function getBrowserState(): BrowserState;
export function onStateChanged(cb: () => void): void; // coalesced (one emit per microtask/frame)
export function tabIdForWebContents(wcId: number): number | null;
export function setContentBounds(bounds: ContentBounds): void;
export function setOverlay(open: boolean): void;
export function serializeSession(): SavedTab[]; export function restoreSession(): void;
// …plus whatever else ipc.ts needs (back/forward/reload/find/zoom/move/duplicate/pin/mute/moveToSpace)
```

## vela:// protocol

`vela://<page>/<file>` → `dist/renderer/pages/<page>/<file>` (default `index.html`).
`vela://shared/<file>` → `dist/renderer/shared/<file>`. Registered as privileged
(`standard`, `secure`, `supportFetchAPI`) before ready, and handled via `session.protocol.handle`
in **every** space session (hook via `onSessionCreated`). Path traversal is rejected.
Pages: `newtab`, `settings`, `error` (`vela://error/?code=…&url=…&desc=…`).

## Build

`scripts/build.mjs` (esbuild): main → `dist/main/index.js` (cjs, node), preloads → `dist/preload/*.js`
(cjs, sandboxed: only `electron` import allowed), renderer entries → iife, static files copied.
`npm run dev` = build + launch, `npm run typecheck` = `tsc --noEmit`.
