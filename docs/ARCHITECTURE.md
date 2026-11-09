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
## Tab groups & tab layouts

* **Model** (`src/main/tab-groups.ts`): a group is `{ id, spaceId, name, color, collapsed }`; membership
  lives on the tab (`TabState.groupId`). tabs.ts keeps one global `order`; `normalizeOrder()` puts pinned
  tabs first and runs `clusterGroups()`, so a group's tabs are always contiguous and a group sits where its
  first tab is. Pinned tabs are never grouped; moving a tab to another space drops its group; empty groups
  are pruned on emit. tab-groups.ts reaches tabs.ts only through the `GroupTabModel` bound at load (no
  import cycle). `BrowserState.groups` lists non-empty groups in display order.
* **Persistence**: each saved tab carries its group (`SavedTab.group`), so the session file stays a flat
  array and older files load unchanged.
* **Renderer**: both layouts render a space's unpinned tabs as a flat list of *units*
  (`tabs/groups/units.ts`: group header `g:<id>` + member tabs) inside one motion `Reorder.Group`;
  `use-unit-drag.ts` turns a drop into `groups.placeTab(tab, beforeTabId, groupId)` or
  `groups.move(group, beforeTabId)`. Collapsed groups contribute only their header (plus the active tab).
* **Layouts** (`settings.tabLayout`, toggle `Ctrl+Shift+,`): *horizontal* = group chips in the top island
  strip; *vertical* = `chrome/vertical/VerticalIsland.tsx`, a floating left island (width
  `settings.sidebarWidth`, icon rail when `settings.sidebarCollapsed`, hover peek) while the top island
  keeps nav + `OmniboxBar`. The vertical island owns a spacer in App's row, so `#viewport` (and thus the
  page `WebContentsView` bounds) follows it; it publishes the column's left edge as `--chrome-left` for
  the fixed top island.

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
src/main/extensions/*  Chrome extensions (lazy)       — extensions
src/main/sync/*        optional E2E-encrypted sync     — sync (engine lazy-loaded)
src/preload/chrome.ts  window.vela                    — ui
src/main/tab-groups.ts tab groups (model + ordering)  — core
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

## Sync (optional, end-to-end encrypted)

Off by default. There is no Vela server: the user picks the storage — a **folder** (OneDrive,
Dropbox, iCloud Drive, Syncthing, a NAS share) or a **WebDAV** collection (Nextcloud etc.). Vela only
ever touches `<storage>/vela-sync/{key.json, dev-<id>.vsync}`.

```
src/main/sync/loader.ts     main bundle: IPC, host adapter, reads userData/sync.json to decide whether to load
src/main/sync/engine.ts     → dist/main/sync.js (own esbuild entry, require()d only when sync is on)
src/main/sync/crypto.ts     scrypt KDF, AES-256-GCM blobs, key file, recovery key
src/main/sync/records.ts    LWW records, hybrid logical clock, merge
src/main/sync/transport.ts  folder + WebDAV (PROPFIND/GET/PUT/DELETE/MKCOL via fetch)
```

**Zero cost when off:** the engine is a separate bundle; with sync off main never parses it, registers
no listeners and starts no timers. `pages:sync-status` answers from the loader without loading it.

**Crypto.** A random 256-bit *data key* encrypts everything. `key.json` (plaintext) holds the scrypt
parameters (N=2^17, r=8, p=1, random 16-byte salt) and the data key sealed with the passphrase-derived
key, plus a sealed constant used to verify a recovery key. The *recovery key* is the data key itself
(base32, 13 groups of 4). Every blob is `"VELASYNC" | version | header JSON | 12-byte random nonce |
ciphertext | GCM tag`; the header (version, kind, writer device id) is GCM additional data, so it is
authenticated. A wrong passphrase, wrong key, flipped bit or swapped header fails authentication and
is reported as such. Payloads are gzipped JSON. KDF parameters read from a remote key file are
bounded before use. On this device the data key and the WebDAV app password are stored only through
Electron `safeStorage` (DPAPI / Keychain / libsecret); sync refuses to turn on without it.

**Model.** Records `{k, v, c, d}`: key, value (`null` = tombstone), hybrid logical clock
(`max(now, last+1)`, advanced by every clock seen), writer device id (tie-break). Per key,
last-writer-wins. Keys: `s/<setting>` (all settings except device-local `windowMaterial`,
`sidebar*`), `sp/<space id>` (name, color, proxy — never ephemeral spaces, never cookies/storage),
`t/<device id>` (that device's open http(s) tabs, max 200), `h/<sha256(url)>` (history, opt-in, newest
2000). Each device writes **only its own** `dev-<id>.vsync` (all records it authored), so shared folders
never see write conflicts; everyone reads everyone else's file and merges. A cycle: verify the
remote key file still matches → capture local changes (diff against last-synced values) → pull and
merge changed files (skipped by mtime/ETag) → apply adopted records → push own file if dirty.
Joining pulls before capturing and pairs same-named local spaces with remote ones (id map) so a fresh
device doesn't duplicate "Personal". Triggers: startup (+3 s), settings/spaces changes (2 s), tab
changes (30 s), every 5 min, folder file-watch, "Sync now".

**Threat model.** Protects the synced data's confidentiality and integrity against the storage
provider, anyone with access to the folder / WebDAV account, and network observers. Not hidden from
them: that Vela sync is used, the number of devices, per-device file sizes and write times, and the
scrypt parameters. Not protected against: a weak passphrase (offline guessing against `key.json`,
slowed by scrypt), malware on an unlocked device (it can read the key via `safeStorage` like Vela
can), or a malicious party who holds the passphrase or recovery key (all devices share one key, so
any device can write records attributed to any id; there is no per-device signing). A storage
provider can delete or roll back files (denial of service / replay of an older state of one device's
file); records carry clocks so a rolled-back file never overwrites newer data that was already merged.
"Wipe remote" deletes the files but cannot guarantee the provider's version history is purged.

## vela:// protocol

`vela://<page>/<file>` → `dist/renderer/pages/<page>/<file>` (default `index.html`).
`vela://shared/<file>` → `dist/renderer/shared/<file>`. Registered as privileged
(`standard`, `secure`, `supportFetchAPI`) before ready, and handled via `session.protocol.handle`
in **every** space session (hook via `onSessionCreated`). Path traversal is rejected.
Pages: `newtab`, `settings`, `error` (`vela://error/?code=…&url=…&desc=…`).

## Extensions (`src/main/extensions/*`)

```
registry.ts  installed list (userData/extensions.json): id, source store|unpacked, path, enabled, spaces 'all'|ids, pinned
runtime.ts   per-Space host: electron-chrome-extensions instance + session.extensions load/unload, tab wiring, action state
webstore.ts  CWS download (electron-chrome-web-store) to userData/Extensions/<id>/<ver>_0, Omaha update checks (5 h)
manifest.ts  name/description (incl. __MSG_*__), icon data URL, options page
index.ts     initExtensions() wiring + registerExtensionIpc() (registered from ipc.ts with handleChrome/handlePages)
```

* **Lazy.** Both libraries are `external` in the main bundle and `require`d only when a Space session has an
  enabled extension to run; with none installed nothing is imported and no session is touched.
* **Per Space.** An `onSessionCreated` hook loads the extensions that run in that Space into its session
  (`spaces: 'all'` = every non-Burner Space incl. future ones). `gateSessionReady()` (spaces.ts) delays the
  Space's first page load until they are loaded (≤ 3 s) so content scripts see the first page. Chromium refuses
  extensions in in-memory sessions, so **Burner Spaces never run extensions**.
* **Tabs.** Every tab `webContents` is registered with its session's `ElectronChromeExtensions` (`addTab`,
  `selectTab` on activation); `chrome.tabs.create/remove/update` map to `tabs.ts`. Sleeping a tab never closes it
  (the library's `removeTab` callback ignores destroyed webContents).
* **Toolbar.** Main pushes `ExtensionsState` (`chrome-event:extensions`) — installed list + actions (title, badge,
  current icon) for the active tab's Space. Clicking an action calls the library's popup (`PopupView`, a child
  `BrowserWindow`, so it floats above the page without the overlay). `setOverlay` never pulls focus back from
  another window, otherwise a tooltip would close the popup.
* **Security.** Extensions may only open/navigate tabs to `http(s)`, `about:blank` or `chrome-extension://`
  (`chrome.tabs.create/update`, `windows.create`, popup/background `window.open`); `vela://`, `file:` and
  `data:` are refused, so privileged pages stay unreachable. Extension pages never get `velaPages` (the pages
  preload only exposes it on `vela:`) and the library's `crx-*` IPC channels are separate from Vela's
  sender-validated channels. The adblocker keeps `webRequest`, so extensions' `chrome.webRequest` listeners
  don't fire (Electron limitation).
## Auto-update (`src/main/updater.ts`)

`electron-updater` against the GitHub releases feed (`publish` in electron-builder.yml → `app-update.yml`).
The module is `require`d lazily on the first check (esbuild keeps it external), so dev runs
(`app.isPackaged === false`) and users with checks turned off never load it.

* Schedule: first check 10 s after startup, then every 6 h (`settings.updateAutoCheck`). Failures are silent
  except for the status line in Settings → About.
* Mode per build: **install** — NSIS installer, AppImage (`APPIMAGE` set), macOS only when signed with a
  Developer ID (checked via `codesign`); background download (`updateAutoDownload`), `autoInstallOnAppQuit`, or
  `quitAndInstall(silent, forceRun)` from the chip after `saveSession()` + `flushAllStores()`.
  **notify** — Windows portable (`PORTABLE_EXECUTABLE_DIR`), deb, unsigned macOS: no download, the UI links the
  release page. Unsigned NSIS updates pass because `app-update.yml` carries no `publisherName`, so
  `verifyUpdateCodeSignature` is skipped; once signing adds a publisher, signatures are enforced.
* Status (`UpdateStatus`) is pushed to the chrome (`chrome-event:update`) and to vela:// settings pages that
  subscribed via `pages:update-watch` (dropped once the page navigates away).
* Release artifacts: `latest.yml` (NSIS only — the portable target writes no update info), `latest-mac.yml`
  (dmg + zip; Squirrel.Mac installs from the zip), `latest-linux.yml` (AppImage), plus blockmaps for
  differential downloads.
* Testing: `VELA_UPDATE_FEED=<http url | local dir>` switches to a generic provider (a local dir is served on
  127.0.0.1); unpacked dev runs then check in notify mode.

## Build

`scripts/build.mjs` (esbuild): main → `dist/main/index.js` (cjs, node), preloads → `dist/preload/*.js`
(cjs, sandboxed: only `electron` import allowed), renderer entries → iife, static files copied.
`npm run dev` = build + launch, `npm run typecheck` = `tsc --noEmit`.
