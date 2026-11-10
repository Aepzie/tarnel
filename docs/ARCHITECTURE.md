# Vela — Architecture

Vela is a Chromium-based desktop browser built on Electron. The browser chrome is a tiny
React + Tailwind + shadcn/ui UI ("Floating Islands", see DESIGN.md); every web page lives in its own sandboxed `WebContentsView`.

## Process & layer model

```
BaseWindow (frame: false; no webContents of its own — saves a renderer process)
└─ contentView
   ├─ chromeView   WebContentsView  full window, loads dist/renderer/chrome/index.html   (base layer)
   └─ tabView(s)   WebContentsView  only the ACTIVE tab (or every pane of its split) is attached, placed at ContentBounds (top layer)
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
* **Workers** (`src/main/fingerprint/workers.ts`) — the same `protectMainWorld` source (it assumes no DOM) runs in
  every worker global scope before the worker's first statement, with the config of the page that owns it:
  * *Dedicated workers* (classic, module, `blob:`, `data:`, nested) and *shared workers*: each tab/popup
    WebContents of a protected Space gets its own DevTools-protocol client (`webContents.debugger`) with
    `Target.setAutoAttach({ waitForDebuggerOnStart, flatten, filter: no service workers })`, re-applied in every
    attached frame and worker, so workers of out-of-process iframes and nested workers are held too. A held worker
    gets `Runtime.evaluate(patch)`, then `Runtime.runIfWaitingForDebugger`; commands of one session run in order, so
    the patch always precedes the worker script. Held out-of-process iframes are resumed only after their own
    `setAutoAttach` answered (it answers at commit; an earlier resume is lost and the frame stays paused). Shared
    workers are not children of a page: `Target.setDiscoverTargets({ filter: shared_worker })` reports them on
    creation and the tab that has a document of the worker's origin attaches (`attachToTarget`) while the script is
    still being fetched. No script is rewritten, so module imports, `importScripts`, relative URLs and CSP
    (`worker-src`) behave natively; no Runtime/Debugger domain is enabled, so pages cannot observe the client.
    User-opened DevTools and `--remote-debugging-port` clients coexist with it (Chromium allows several clients);
    if another client already owns the debugger, that tab's workers stay unpatched. Spaces set to `'off'` attach
    nothing (switching detaches).
  * *Service workers*: a `service-worker` session preload (`dist/preload/fingerprint-worker.js`,
    `src/preload/fingerprint-worker.ts`) runs before the worker script without any tab, asks main synchronously on
    the worker's own `ServiceWorkerMain.ipc` (wired at the `'starting'` running status, before the preload runs;
    an unanswered `sendSync` would hang the worker, so it always answers) and patches the scope through
    `contextBridge.executeInMainWorld`.
  * Cost: ~2–3 ms more per dedicated worker start (median 8–9 ms vs 6 ms for an empty worker), one IPC per service
    worker start.
* **Determinism** — main derives `key = HMAC(seed, top-level eTLD+1)`: stable per site across reloads and restarts,
  different per site and per Space; third-party iframes use the top-level site's key, and so do the workers they
  start (dedicated: the tab's top-level page; shared: the top-level page of the tab that claims it; service: the
  scope's site, the top-level site for first-party workers). Hardware values derive from the seed only (same
  machine across all sites of a Space).
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
| Timezone (`Intl`, `Date` offset/strings, `toLocale*`) | per Space setting (Automatic = system) | per Space setting (Automatic = UTC, or the MantelVPN country's zone in a routed tab) |
| Intl default locale, `navigator.language(s)`, `Accept-Language` | per Space language (System = real) | same |
| Font enumeration (`measureText`, `FontFaceSet.check`, `queryLocalFonts`) | real | fonts outside a common per-platform set (the page's own web fonts excepted) measure as missing; `queryLocalFonts` denied |

Every row applies in workers too where the API exists there (`WorkerNavigator`, `OffscreenCanvas` 2D/WebGL,
`TextMetrics`, `NavigatorUAData`); workers have no screen, media devices, gamepads, battery or Web Audio.

Timezone and locale are not patched in JavaScript: the tab's DevTools-protocol client (the one that holds workers) sends `Emulation.setTimezoneOverride` / `Emulation.setLocaleOverride` to the page and every out-of-process iframe before it runs. Chromium applies them to the whole renderer process, so dedicated workers in it agree natively (measured: window and blob worker both `Asia/Tokyo`, offset -540, `de-DE`). The override is process-wide: a second tab sharing a renderer gets "already in effect" (same Space, same value) and re-claims it when the owning tab closes. Service workers and shared workers in their own process keep the system zone. DOM-based font probing (element widths) is not covered.

**Not protected:** CSS media queries (`device-width`, resolution), DOM-based font enumeration, timezone/`Intl` (left
alone: spoofing breaks calendars, banking and booking sites), the IP address itself (use a per-Space proxy), worklets
(audio/paint worklets: no navigator, detached unpatched). Worker gaps: a third-party *service* worker is keyed by its
own site (its top-level site is not known in main), a shared worker that two tabs of different top-level sites embed
through the same third-party origin may get the other tab's key, and a worker that is already running when a Space is
switched on stays unpatched until it restarts. Fingerprinting test suites (CreepJS) can still detect *that* noise is
applied (pixel/audio noise); what they cannot do is link two Spaces through it. Changes apply to pages loaded
afterwards.
## Browser identity (every Space)

Google's sign-in refuses embedded browsers ("This browser or app may not be secure"). Electron is Chromium's content
layer without the Chrome browser layer, so stripping `Electron/x` from the UA (`cleanUserAgent`) is not enough: the
other signals must also look like a stock Chromium browser. Vela does not claim to be Google Chrome. The brand list
(`"Chromium"` + GREASE) is what Electron already reports, and it is the same in the UA, `Sec-CH-UA` and
`navigator.userAgentData`. Independent of fingerprint protection (`src/main/identity/*`, `src/preload/identity*.ts`):

* **User-Agent**: `Chrome/<major>.0.0.0` (Chromium's UA reduction); the build number is only available through
  hints. Set in `app.userAgentFallback` and per session (`privacy.ts`), so workers and popups get it too.
* **`window.chrome`**: the identity preload (`registerPreloadScript`, type `frame`, every session) runs
  `shapeMainWorld` in the main world of every frame with an http(s) *origin* (so `about:srcdoc` frames too):
  `chrome.app` / `csi()` / `loadTimes()` with Chromium's shape and values from Navigation Timing, functions with
  native `toString`. Preloads never run in a new iframe's initial `about:blank` (or what `document.write` puts in
  it), so, like the fingerprint patch, DOM insertions that add a frame and `contentWindow` / `contentDocument` shape
  the same-origin child realm on the spot (objects and functions created in the child's realm).
* **Client hints**: Electron has no client-hints delegate, so its network stack sends no `Sec-CH-UA*` on
  navigations and ignores `Accept-CH`. The chrome UI preload (and each top frame) sends the real
  `getHighEntropyValues()` once (`vela:identity-hints`, read in the isolated world); `onBeforeSendHeaders`
  (`identity/headers.ts`) adds the three low-entropy hints to every request to a potentially trustworthy origin that
  lacks them, and the high-entropy set only for `accounts.google.<tld>` / `accounts.youtube.com`, which ask for it on
  every response. `applyFingerprintHeaders` runs afterwards, so Strict reduces them like `getHighEntropyValues()`.
* **Accept-Language**: the UI locale followed by the OS languages, the list Electron's renderer reports as
  `navigator.languages` (its network stack sent only the locale).
* **Passkeys**: Electron has no autofill UI for conditional mediation, so on Windows a page's on-load
  `credentials.get({ mediation: 'conditional' })` would open the modal Windows Hello dialog. The main-world script
  reports `isConditionalMediationAvailable()` = false (and `conditionalGet/Create: false` in
  `getClientCapabilities()`) and keeps conditional WebAuthn requests pending until the page aborts them. Explicit
  WebAuthn calls are untouched.

A per-host Firefox UA for `accounts.google.com` (used by some Electron apps) was rejected: it does not get past the
check, because every other signal still says Chromium. **Not covered:** `Notification.permission` is `"denied"`
instead of `"default"` (Electron's permission check handler only answers true/false), `navigator.webdriver` is
already false. Same-origin iframes and `about:blank` child realms that Chromium creates without running session
preloads don't get the `window.chrome` shape.

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

## Split view

* **Model** (`src/main/split.ts`): a split is `{ id, spaceId, tabIds (2–4, pane order), ratioX, ratioY }`, a per-Space
  relationship between tabs; `TabState.splitId` / `BrowserState.splits` expose it. The split holding `activeTabId` is
  on screen and the **active tab is its focused pane**, so omnibox, nav buttons, find, zoom and shortcuts need no
  split awareness. Invariants: members are unpinned (pinning or moving a tab to another Space takes it out), adjacent
  in pane order (`clusterSplits` runs after `clusterGroups` in `normalizeOrder()`) and share one group (the
  `GroupTabModel` gained `unitOf()`; grouping, ungrouping and `placeTab` move a split as one unit). A split with one
  tab left dissolves; closing the focused pane focuses its partner. Persistence: `SavedTab.split = { id, ratioX, ratioY }`.
* **Geometry** (`src/shared/split-layout.ts`): `splitGeometry()` turns the viewport rect into pane rects (2 = columns,
  3 = left + stacked right, 4 = 2×2, 8px gaps, 220px min pane). Main uses it to place the views; the chrome uses the
  same function to draw pane frames, the accent focus ring and the dividers in the gaps (`chrome/split/SplitPanes.tsx`).
  A divider drag sends live ratios (`split.resize(…, commit=false)`, views re-placed, no state emit) and commits on release.
* **Window** (`window.ts`): keeps a list of visible views (`showViews`) instead of one; `restack()` re-adds them (focused
  last) under the chrome when it is raised, for overlays, chrome crash/reload resets and the transparent-window swap.
  Moving focus between panes does not re-stack (that would cancel the press). `setPeek()` raises the chrome *without*
  taking focus.
* **Pointer** (`split-panes.ts`): only while a split is on screen, `before-mouse-event` on its panes focuses a pane on
  press and reports when the pointer reaches a pane's top-center hot zone; the chrome then peeks and shows the pane
  toolbar (swap / close split / close tab) until the pointer leaves.
* **Entry points**: tab context menu, drag a tab onto the left/right edge of the page (the chrome holds the overlay
  while a tab is dragged and paints the drop preview), palette, `Ctrl+Shift+D` (`toggleSplit()`: close, or split with
  the most recently used tab, or with a new tab). Strip and vertical list render a split as one joined unit
  (`SplitUnit` in `tabs/groups/units.ts`).
* **Sleeping**: `isOnScreen()` replaces "is active" for the sleeper and crash handling; showing a split wakes all panes.
* **Cost when unused**: no listeners, no extra views; `clusterSplits` returns early and the chrome renders nothing.

## Per-tab audio devices

* **Model** (`src/main/audio-devices/state.ts`): per tab, an optional pick per slot `output | input | camera`, stored as
  `{ label, ordinal, index }` — device ids are salted per origin (and differ in the chrome), so a device is matched by
  label (`ordinal` tells identical labels apart; `index` among the real devices of the kind is used when strict
  fingerprint protection reports generic labels). `TabState.devices` / `micActive`, persisted as `SavedTab.devices`.
* **Device list**: the chrome (`chrome/audio/device-store.ts`) enumerates in its own trusted file:// view, which gets
  labels without a prompt. It enumerates only while a menu/popover is open or a tab has a pick (to mark unplugged ones).
* **Injection** (`src/main/audio-devices/index.ts`): `dist/preload/audio-devices.js` is registered as a frame preload
  only on the sessions of Spaces that have a routed tab (unregistered when none is left); it asks main synchronously for
  the route of its tab (null → stop) and runs `src/preload/audio-devices-main-world.ts` in the main world before page
  scripts. Documents already loaded when the pick changes are routed in place with `WebFrameMain.executeJavaScript` of
  the same function in every frame (a second call only swaps the route; resetting to default restores `''` sinks).
* **Output**: media elements get `setSinkId(chosen)` on `play()` / the document `play` event / route change (detached
  `new Audio()` included), AudioContexts on their first `destination` read. A page that picks a specific sink keeps
  it; `setSinkId('')` / `'default'` gets the tab's pick. Unknown device (unplugged) → default; `devicechange`
  re-resolves, so it comes back when replugged. **Input**: `getUserMedia` audio/video constraints without a page-chosen
  device get `deviceId: { exact }` (retry without on Overconstrained/NotFound/NotReadable); `enumerateDevices` lists
  the picks first. Capture still goes through the permission prompt; `micActive` is set when it grants audio and
  cleared on cross-document navigation.
* **Permissions**: privacy.ts' check handler answers `media` checks with true for frames of a routed tab
  (`setMediaPermissionHooks`), so device ids/labels are exposed there and non-default sinks are allowed. Chromium
  additionally requires cross-origin iframes to be delegated `microphone` + `speaker-selection`: the main-world script
  adds that `allow` before script insertion and re-inserts parser/innerHTML-inserted iframes in the same microtask
  (before their first commit). Subframes still can't capture (main only prompts for top frames).
* **Limits**: AudioContexts that read `destination` before a live (non-preload) routing, and cross-origin iframes that
  were already loaded then, follow after a reload; `about:blank` child realms and legacy `navigator.getUserMedia` are
  not hooked; live input changes apply to the next capture (running tracks are not swapped). Patched functions report
  native `toString`, but the routing is observable by a page in a routed tab (e.g. the `allow` attribute).
* **Cost when unused**: no preload, no listeners in pages, no permission change; the chrome enumerates nothing.

## Audio mixer (UI: `src/renderer/chrome/mixer/*`)

Contract: `src/shared/audio-mixer.ts` (settings, presets, levels, routing) + `window.vela.mixer`. The UI only talks
to that API, plus the existing tab mute (`tabs.toggleMute`) and per-tab devices (`mediaDevices.set`).

* **Entry**: `MixerButton` in the top island's right cluster (both tab layouts), `Ctrl+Shift+M` (main sends the
  `audio-mixer` UI command; in focus mode it reveals the island first) and the palette command "Audio mixer"
  (`mixer-commands.ts`). The button shows three bouncing bars while any tab is audible. The popover holds the overlay
  (`useOverlayPresence`).
* **State** (`mixer-store.ts`): one `useSyncExternalStore` store mirroring `MixerTabState[]` from `get()`/`onState`.
  Edits apply locally at once and stream to main through `set` throttled per tab (40 ms, leading + trailing); pushes
  from main within 500 ms of a local edit keep the local settings so a dragged fader never jitters. Channel strips =
  tabs that are audible, muted or known to the mixer, in tab order. **Solo** mutes the other channels through the tab
  mute and remembers exactly which ones, so un-soloing (or soloing another tab) unmutes only those.
* **Levels** (`levels.ts`): `watchLevels(true)` only while the panel is mounted (open); pushes (~20 Hz) land in a
  plain map, never in React state. One shared rAF loop drives the meters (instant attack, linear release in dB space,
  0.9 s peak hold), the 16-bin spectrum canvas and the bass wave; meters write `clip-path`/`transform` on refs.
  Levels older than 400 ms count as silence. Reduced motion: no interpolation, no wave/ping animation.
* **EQ graph** (`EqGraph.tsx`, `eq-math.ts`): the curve is the summed RBJ biquad magnitude of what the engine applies
  (peaking per band, Q 1.41; low shelf for bass boost, Q 0.707) on a 20 Hz–20 kHz log axis, ±15 dB view with a ±12 dB
  grid; with the EQ off a dashed ghost shows the bands. Handles are `role="slider"` (Up/Down ±1 dB, Shift ±0.5,
  PageUp/Down ±3, Left/Right/Home/End move between bands, Delete/double-click reset). Editing a band turns the EQ on
  and clears `preset`.
* **Routing** (`routing-note.ts`): `partial` → the detail header says only volume applies to some audio (strip:
  "Volume only"); `reload` → "Reload to apply" + a Reload button; `idle` on an audible tab → nothing (it is playing,
  just unprocessed); "No sound yet" only when the tab is not audible. Spectrum for `full` and audible `idle`.
* **Devices**: the detail pane reuses `chrome/audio` (`useDeviceSections` + `selectDevice`), no own enumeration.
* **Dev mock** (`mock.ts`): when `mixer.get()` rejects with "No handler registered" (no engine in main), the store
  swaps in a simulated engine for the first N tabs (localStorage `vela:mixer-mock-tabs`, default 3) with animated
  levels/spectrum that follow the settings, and the header shows "Simulated". With real handlers it is never created.
## Audio mixer (engine)

Per-tab volume (0–2), balance, mono, 10-band EQ (31 Hz–16 kHz, ±12 dB), bass boost and a gentle compressor; contract
in `src/shared/audio-mixer.ts`, chrome API `vela.mixer`. Desktop only. Mute stays the tab mute (`setAudioMuted`).

* **Model** (`src/main/audio-mixer/state.ts`): only non-default settings are stored, persisted as `SavedTab.audio`
  (the save is debounced while sliders move). Chrome input is type-checked and clamped (`applyAudioPatch`); a
  preset without bands loads its bands (and its bass boost if it has one), editing bands drops the preset unless they
  still match. `vela.mixer.get()` / the `stateEvent` push list tabs that are audible or have settings, in tab order.
* **Injection** (`src/main/audio-mixer/index.ts`): like audio devices, `dist/preload/audio-mixer.js` is a frame
  preload registered only on Spaces with a tab whose settings are not `isNeutralAudio`; it asks main synchronously
  (`vela:mixer-engine`) and runs `src/preload/audio-mixer-main-world.ts` in the main world before page scripts.
  Documents already loaded get the same function via `WebFrameMain.executeJavaScript` in every frame (cross-origin
  iframes included); later changes only call the installed handle's `update()` (coalesced to one push per 16 ms).
  Neutral settings switch installed engines to bypass; new documents of the tab then get nothing. A live install
  survives a realm whose `Function.prototype.toString` is already patched and broken (YouTube with the blocker's
  scriptlets recurses forever): every patch is installed independently and falls back to a synthetic native source.
* **Already playing at a live install**: media found by the sweep (document + open shadow roots) is captured at
  once, with a 30 ms fade-in on the captured path so the latency jump is a dip, not a click; media nobody can find
  (detached, closed shadow roots) is caught on its first `currentTime` read, and shadow roots attached later are
  watched. When the tab is audible with settings and its engines still process nothing, main runs a one-shot
  *adoption* per document (`adopt.ts`): over the tab's DevTools protocol client (reused if fingerprint protection
  holds it, otherwise attached/detached) `Runtime.queryObjects` lists every `AudioNode` and media element of the top
  document's main world; the engine moves each node output feeding a realtime destination into its chain
  (`disconnect(destination, output)` is the probe) and routes playing media.
* **Graph** (one chain per realtime AudioContext): `input → [mono] → [balance] → [bass lowshelf] → [EQ peaking Q 1.41,
  bands ≠ 0] → [compressor −24 dB/3:1/knee 24] → [volume] → [limiter → soft clip] → output → destination`. Only the
  stages the settings need are wired; the limiter (20:1 at −3 dBFS, attack 2 ms, its automatic makeup gain cancelled)
  and the tanh soft clipper (transparent below 0.85) are added only when something boosts, so quiet material passes
  bit-exact. Parameters move with a 15 ms time constant. Balance is a true balance (each side ≤ 1), not a panner.
* **Sources**: media elements go through the engine's own processing AudioContext (`latencyHint: 'interactive'`,
  created on first playback, suspended after 10 s with nothing playing). Page AudioContexts keep their own context:
  `AudioNode.connect/disconnect` to a realtime destination is redirected into that context's chain (offline contexts
  untouched). WebRTC / `srcObject` MediaStreams use `createMediaStreamSource` with the element natively muted
  (Chromium gives silence for remote streams through `createMediaElementSource`); the page still sees its own
  `muted` / `volume`, and pause silences the stream. Muted elements (background videos) are left alone until unmuted.
* **Silence pitfall**: capturing an element is permanent (closing the context does not release it) and Web Audio
  outputs zeros for media the page may not read. Elements are captured only for blob:/data:/MSE/MediaStream sources,
  CORS loads (`crossOrigin` set) and same-origin URLs whose same-origin `HEAD` (mode `same-origin`) does not redirect
  away; cross-origin no-CORS media, encrypted media (`mediaKeys`) and elements with a page-chosen `sinkId` stay native
  and only get `min(volume, 1)` through `element.volume` (the page keeps reading its own value) → routing `partial`.
  A page that later calls `createMediaElementSource` on a captured element gets a MediaStream bridge from the
  processing context instead of an exception.
* **Audio devices**: the processing context reads `destination` through the (possibly patched) prototype getter, so
  the per-tab output route steers it; a live route change pokes engines (`touch()`) so it follows too.
* **Routing / levels**: engines report what they process right now: `full` (routed media playing or a page chain
  with connected inputs), `partial`, else `idle` (also always at neutral). Main asks engine frames (`report(false)`)
  on media start/pause and audible changes; an audible tab with settings whose engines stay `idle` (after a 750 ms
  settle window, a 3 s grace after it last processed sound, and the adoption) becomes `reload`. While the chrome watches (`watchLevels(true)`), main polls every engine frame of each audible tab every
  50 ms (`report(true)`: L/R peak from 4096-sample analysers after the chain, 16 log bins 20 Hz–20 kHz mapped from
  −90…−10 dB); results are validated, max-merged per tab and pushed as `TabAudioLevel[]`. Analysers are connected
  only while being read (disconnected 1.5 s after the last read). Media the engine does not own (untouched tabs,
  partial elements) is metered by a level tap (`audio-mixer-tap-main-world.ts`): `captureStream()` copies into a
  context with no output (nothing rerouted), installed only in frames with playing media (all frames rescanned each
  second), released when watching stops and self-released 2 s after its last read. Page AudioContexts of untouched
  tabs are not metered.
  Watching stops when the chrome navigates or crashes.
* **Cost**: unused → no preload, nothing in pages. Measured (Windows 11, one tab playing a WAV): +0.6 % of one core in
  the renderer for a single stage, +1.6 % with every stage, +0.2–0.3 % in the audio service.
* **Limits**: adoption only covers the top frame's main world (subframes, incl. cross-origin embeds, fall back to
  `reload` for pre-existing AudioContext connections), skips tabs whose protocol client is unavailable, and walks the
  heap once (a few ms to ~100 ms); untouched-tab meters miss page AudioContexts and media the tap cannot copy
  (cross-origin without CORS, encrypted); an element captured
  with a readable source that later switches to a cross-origin no-CORS source plays silent until reload; captured
  elements ignore a page-chosen `setSinkId` (MediaStream elements are released instead); the bridge node is a
  `MediaStreamAudioSourceNode`, not a `MediaElementAudioSourceNode`. Patched functions report native `toString`, but
  the engine is observable by the page (`Symbol.for('vela.mixer')`).

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
src/main/dns.ts        DNS-over-HTTPS (global host resolver; presets + validation in src/shared/doh.ts) — data
src/main/fingerprint/* per-space fingerprint seeds, preload registration, header hints, worker patching (CDP) — data
src/preload/fingerprint*.ts  main-world fingerprint patch (frame + service-worker session preloads) — data
src/main/identity/*, src/preload/identity*.ts  Chromium identity: window.chrome shape, client-hint headers (every Space) — data
src/main/perf/*        flags, adblock, sleeper, metrics — perf
src/main/extensions/*  Chrome extensions (lazy)       — extensions
src/main/extensions/dnr/*, src/preload/extension-api.ts  declarativeNetRequest engine + extension-context API — extensions
src/main/net/*         webRequest dispatcher (one listener per event, ordered stages), registrable domain — core
src/main/safety/*      phishing & malware protection (local blocklists, warning interstitial) — core
src/main/sync/*        optional E2E-encrypted sync     — sync (engine lazy-loaded)
src/preload/chrome.ts  window.vela                    — ui
src/main/tab-groups.ts tab groups (model + ordering)  — core
src/main/split*.ts     split view (model, pane pointer, IPC) — core
src/main/audio-devices/*, src/preload/audio-devices*.ts  per-tab audio devices (route, preload, main-world patch) — core
src/main/audio-mixer/*, src/preload/audio-mixer*.ts  per-tab audio mixer engine (settings, preload, Web Audio graph) — core
src/renderer/chrome/*  top-island UI (React)          — ui
src/renderer/chrome/mixer/*  audio mixer panel (strips, EQ graph, levels, dev mock) — ui
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
export function importHistory(entries: readonly HistoryEntry[]): number; // browser import; merges like sync, returns entries kept
export function clearHistory(): void;
```

### `src/main/privacy.ts`
```ts
export function cleanUserAgent(ua: string): string; // strip "Electron/x.y.z" and "vela/x.y.z" tokens, Chrome/<major>.0.0.0
export function acceptLanguages(): string;   // UI locale + OS languages (matches navigator.languages)
export function applyPrivacy(session: Electron.Session, space: Space): void;
// - setUserAgent(cleanUserAgent(session.getUserAgent()), acceptLanguages())
// - permission request/check handlers: allow fullscreen, clipboard-sanitized-write, pointerLock,
//   media only when requested by the top frame; deny everything else by default (no prompts in v0.1)
// - onBeforeSendHeaders: DNT:1 + Sec-GPC:1 when settings.sendDoNotTrack
// - https-only: onBeforeRequest upgrade http:// main-frame navigations to https:// (except localhost/127.0.0.1/LAN)
// - third-party cookie blocking via onHeadersReceived stripping Set-Cookie on third-party sub-resources when enabled
```
NOTE: `webRequest` allows only ONE listener per event per session, so nothing calls
`session.webRequest.*` directly: privacy.ts registers its header work as a stage of the shared
dispatcher (see [Network pipeline](#network-pipeline-srcmainnet)). https-only upgrade is done in tabs.ts
(`will-navigate`/URL resolution) and privacy.ts exposes `export function upgradeToHttps(url: string): string`.
Third-party cookie blocking strips the `Cookie` header on third-party sub-resource requests in that stage.

### `src/main/dns.ts` (Secure DNS)
```ts
export function initSecureDns(): void; // after 'ready'; re-applies on every settings change
```
Settings → Privacy → Secure DNS maps `secureDns` (`off` | `automatic` | `cloudflare` | `quad9` | `mullvad` |
`mullvad-adblock` | `nextdns` | `custom`), `secureDnsStrict`, `secureDnsNextDns` and `secureDnsTemplate` to
`app.configureHostResolver({ secureDnsMode, secureDnsServers })` via the pure `resolveSecureDns()` in
`src/shared/doh.ts`. Provider + Strict = Chromium `secure` mode (lookups fail instead of falling back to plain
DNS); without Strict = `automatic` with that server. `automatic` alone upgrades only when the system resolver is a
known DoH provider. A NextDNS/custom choice without a valid template resolves to `off` (never a strict mode with no
server). Templates must be `https://` without credentials or fragment, plain (POST) or ending in `{?dns}` (GET);
`sanitize()` rejects anything else, so persisted values are always valid or `''`.

* **Process-global.** Electron's host resolver lives in the single network service, so this is one setting for
  every Space; per-Space DoH is not possible. `configureHostResolver` can be called again at any time after
  'ready' and applies to the next lookup (verified on Electron 45: strict with an unreachable server fails with
  `ERR_DNS_SECURE_RESOLVER_HOSTNAME_RESOLUTION_FAILED` right after the call), so no restart is needed. While the
  setting has never left `off`, Vela does not call it at all (Chromium defaults).
* **Proxied Spaces.** A Space or tab behind a proxy (MantelVPN, SOCKS5, HTTP) hands the hostname to the proxy
  (`CONNECT host`, SOCKS5 remote resolution), so the proxy resolves it and DoH does not apply there.

### `src/main/perf/flags.ts`
```ts
export function applyChromiumFlags(): void; // called before app 'ready'
```

### `src/main/perf/frame-rate.ts`
```ts
export function frameRateFeatures(): string[];       // before 'ready': ['UseCompositorClockVSyncInterval'] when settings.frameRate + saved display layout + saved window bounds call for it (Windows)
export function initFrameRate(): void;               // after 'ready': save the display layout (userData/displays.json) for the next launch, kept current on display changes
export function getFrameRateStatus(): FrameRateStatus; // displays + Hz, rate Chromium paces to, restartRequired (velaPages.frameRate)
export function relaunchApp(): void;                 // velaPages.relaunch
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

## Panic button (`src/main/panic.ts`)

`Ctrl+Shift+Delete` (shortcuts.ts) or the palette command → `PANIC_IPC.run` → `panic()`: minimize the window
first, mute every unmuted tab (reversible), `vpn.disconnectAll()` (restore the Space route, clear per-tab
routes; the account stays signed in), then `removeSpaceWithTabs()` for every Burner Space (normal disposal wipes
its in-memory session; its tabs are not kept in the reopen stack). Only with `panicClearRecentHistory` on does it
touch persistent data: `deleteHistorySince(now - 15 min)` removes entries whose last visit is in that window.
## Site info & site data on close (`src/main/site-data.ts`)

- Contract: `src/shared/site-data.ts` (pure, unit-tested: `SITE_IPC`, `SiteInfo`, `SiteDataPolicy`, exception matching). Chrome API `vela.site.*`, pages API `velaPages.siteData.*`.
- **Site info** (`src/renderer/chrome/site-info/SiteInfoPanel.tsx`): the palette's lock/host chip opens a portalled popover inside the palette's overlay. `getSiteInfo(tabId)` reads the tab's session (its VPN partition when routed): cookies via `cookies.get({ domain: <registrable domain> })`, storage via `navigator.storage.estimate()` in an isolated world (800 ms cap), permission answers via `listOriginDecisions` in `permissions.ts`. "Secure" is the tab's https state; Vela installs no certificate-error override, so an https page that loaded passed Chromium's verification (no certificate details are shown).
- **Clear site data**: removes the site's cookies (registrable domain and subdomains) and `clearData({ origins })` for the tab origin plus bare/`www` https/http variants (localStorage, IndexedDB, service workers, file systems, WebSQL, background fetch; not the HTTP cache).
- **Policies** (store `site-data.json`, `Record<SpaceId, SiteDataPolicy>`): `clearOnExit`, `clearOnLastTab`, and per-site overrides `sites[pattern] = 'keep' | 'clear'` (a pattern covers its subdomains; the most specific wins). On quit, `clearSiteDataOnQuit()` runs in the `before-quit` dispose race (extra 3 s when anything is pending): whole-Space clear when nothing is kept, otherwise cookies are filtered per domain and storage is cleared with `excludeOrigins` = kept sites' origin variants + open tabs' origins of kept sites. Persistent Spaces only; VPN country partitions are not touched.
- **Last tab**: an `onStateChanged` diff of open (Space, site) pairs schedules `clearSite` 30 s after a site's last tab in a Space closes (cancelled if it reopens). Kept sites are never cleared.

## VPN (MantelVPN)

`src/shared/vpn.ts` (contract + pure parsers, unit-tested), `src/main/vpn/mantel.ts` (API client),
`src/main/vpn/index.ts` (state, safeStorage, Space routing, `vela.vpn.*` IPC), UI in `src/renderer/chrome/vpn/*`.

**Mantel API** (wire format taken from the public Windows client
[Mantel-Collective-LLC/mantel-windows](https://github.com/Mantel-Collective-LLC/mantel-windows), GPL-3.0: only
endpoint shapes are reused, no code). Base `https://mantelvpn.com` (the client takes it from `MANTEL_API_URL` at
build time; `mantelvpn.com/api/v1/*` answers with Mantel's JSON errors). `VELA_MANTEL_API_URL` may point at a
loopback mock for development (http only for loopback).

| Call | Use in Vela |
|---|---|
| `POST /api/v1/auth/login` `{code, totp}` → `{token, account:{id, paidUntil}}` | sign in with the 16-digit account number; bearer token kept in memory only |
| `GET /api/v1/account` → `{paidUntil, graceUntil?, devices, settings}` | expiry |
| `GET /api/v1/nodes` → `[{id, city, country, endpointHost, endpointPort, online, latencyMs?, status?}]` | server list (needs auth in production; no load figure) |
| `GET/POST/DELETE /api/v1/proxies` → `{proxy:{host, port, protocol, exit, username}, password}` | per-location account proxy used for Connect |
| `POST /api/v1/auth/logout` | sign out |

Not used: `POST /api/v1/devices` (registers a WireGuard public key, returns the tunnel config), port forwarding,
Tor, tickets, two-factor (`totp_required` is shown as unsupported).

**Tunnel.** The Mantel app brings WireGuard up through the official WireGuard for Windows tunnel service, driven by
the closed-source, admin-installed Mantel Service over a named pipe (kill switch = Windows Firewall rules). A browser
cannot do that, so Vela does not register devices or keys.

**Connect = Space proxy.** Mantel offers account-scoped "server proxies" (SOCKS5, HTTP, MTProto; exit "direct" =
the location's IP, or Tor). Connect lists the account's proxies, reuses Vela's own HTTP proxy for that location or
creates one (`name: "Vela", protocol: "http", exit: "direct"`), stores the once-shown password with safeStorage and
sets the active Space's proxy to `http://host:port` (existing fail-closed Space proxy path). Chromium cannot do
SOCKS5 username/password auth, hence HTTP; the `Proxy-Authorization` challenge is answered in main via `app.on('login')`
only for the exact host:port in use. HTTPS sites stay end-to-end TLS inside `CONNECT`; the proxy credentials
themselves travel in plain text to the proxy (Mantel's own app warns about this). Disconnect, sign-out and the next
start restore the Space's previous proxy (unless the user changed it). Sign-out deletes Vela's proxies and the token.

**Per-tab routing.** Electron applies proxies per *session*, not per webContents, so a tab routed through a
country lives in its own partition per (Space, country): `persist:space-<id>-vpn-<cc>` (`space-<id>-vpn-<cc>` for
Burners, in memory). `spaces.getSpaceSession(spaceId, cc)` creates it lazily under the session key `<id>@vpn-<cc>`
and runs every `onSessionCreated` hook with the owning Space (privacy, identity, fingerprint seed, adblock, vela://,
extensions; `gateSessionReady(space.id)` called from inside a hook applies to the session being created). Its
proxy comes from the provider the VPN module registers (`setRouteProxyProvider`): `http://<host:port>` of the
stored Mantel proxy for that country (`vpn.json` `countries: {cc → proxy id}`), else the blackhole — fail closed,
also after sign-out or when the proxy was deleted. `refreshRoutedProxies()` re-applies it after changes.
`vpn.routeTab(tabId, cc)` picks the country's server (`shared/vpn-route.ts`: usable, lowest ping), reuses or creates
one Mantel proxy per location (same `credentialFor` as Connect) and calls `tabs.setTabVpn`, which destroys the view,
keeps its history and recreates it in the other session (position, group and split stay). Pages opened from a
routed tab inherit its route. `SavedTab.vpn` persists the choice; a restored routed tab works without contacting
the API (the proxy and its password are stored). Proxy auth is answered per session: a routed session gets only
its country's credential. Removing a Space (or quitting with Burners) also wipes its routed partitions.
Limitations: a routed tab has separate cookies/storage per country (said in the menu); per-tab audio
device/mixer preload scripts are registered on Space sessions only, so they do not apply to routed tabs; the
fingerprint seed is the Space's.

**Preview fallback.** If the API is unreachable (network error/timeout), the panel shows built-in preview servers and
a simulated connection, labelled "Preview"; nothing is routed.

**What Mantel would need to provide for a solid in-browser VPN:**
1. Proxy endpoints meant for browsers: HTTPS proxy (TLS to the proxy, so credentials are not sent in clear) or SOCKS5
   over TLS, on every location, with documented hostnames and limits (Vela creates one per used location).
2. A scoped app token / OAuth-style device grant ("Vela may manage proxies") instead of the raw account number, plus
   token refresh; ideally revocable from the Mantel account page.
3. A public, unauthenticated location list (or one usable with that scoped token) including load.
4. Two-factor support for third-party clients (the login takes `totp`; Vela has no prompt yet).
5. Stated rate limits and a stable, versioned API contract for partners.
6. Alternatively a userspace WireGuard → local SOCKS bridge (wireproxy-style) that Mantel ships and signs; Vela would
   then point a Space at `socks5://127.0.0.1:<port>` without admin rights. Vela does not bundle such a binary today.

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

## Import from other browsers (`src/main/import/*`)

Settings → Import (`vela://settings/#import`) plus a dismissible "Import from Chrome" pill on a fresh
new tab page (shown only while there are no top sites; dismissed for good on click or after any import,
state in `import-hint.json`).

- **Detection** (`sources.ts`): Chromium family (Chrome, Edge, Brave, Vivaldi, Opera, Chromium) from
  the per-OS user-data folder (`%LOCALAPPDATA%`, `~/Library/Application Support`, `~/.config`;
  Opera lives in `%APPDATA%` and keeps a single profile directly in that folder). Profiles are
  `Default` / `Profile N` folders containing `Bookmarks` or `History`; names come from
  `Local State` → `profile.info_cache`. Firefox from `profiles.ini` (plus snap / flatpak roots on
  Linux) → `places.sqlite`. The renderer only ever sees opaque profile ids, never paths.
- **Bookmarks**: Chromium `Bookmarks` JSON (roots `bookmark_bar`, `other`, `synced`; `date_added` is
  µs since 1601) / Firefox `moz_bookmarks` ⋈ `moz_places` assembled into a tree by `parent` +
  `position` (tags, separators and `place:` queries dropped). Handed to
  `bookmarks.importBookmarkTree(spaceId, "Imported from <browser>", tree)` as a new folder.
- **History**: Chromium `urls` / Firefox `moz_places`, last 90 days, most visited first, at most
  5,000 (Vela's history cap) → `history.importHistory`. Chromium's `last_visit_time` exceeds 2^53,
  so it is scaled to ms inside the SQL query.
- **SQLite** (`sqlite.ts`): Node's built-in `node:sqlite` (Electron 45 ships Node 24; loaded lazily
  with `import()`, so it costs nothing at startup). The source database is never opened: it is copied
  (with its `-wal`) to a private temp folder, opened read-only (falling back to a normal open of the
  copy when a WAL needs a writable `-shm`), and the folder is deleted afterwards.
- **Passwords**: other browsers' encrypted stores are deliberately not read (Chrome's app-bound
  encryption would make it fragile, and it would look like credential theft). Instead the user picks
  an exported CSV through a main-process file dialog; `csv.ts` parses it (RFC 4180, BOM, Chrome / Edge /
  Brave, Firefox, Bitwarden, 1Password, generic url/username/password headers). The parsed logins stay
  in main behind a 10-minute token; the page only gets a count, then calls
  `importPasswords(token, spaceId)` → `passwords.importLogins`.
- IPC: `IMPORT_IPC` (`src/shared/import.ts`), pages-only (`handlePages`), exposed as
  `velaPages.browserImport`.

## Network pipeline (`src/main/net/*`)

Electron keeps exactly one listener per `webRequest` event per session (a second registration silently
replaces the first). `net/dispatcher.ts` owns that listener and runs ordered, synchronous **stages**
(`addWebRequestStage(session, event, name, order, fn)`); a stage name is unique per event and session.

| Event | Stages (in order) | Composition |
|---|---|---|
| `onBeforeRequest` (`<all_urls>`) | `safety` (40: dangerous-site warning), `url-clean` (50, main-frame GET only, present only while "Remove tracking parameters" is on), Ghostery `adblock` (100), extension `dnr` (200) | first cancel / redirect wins, later stages are skipped |
| `onBeforeSendHeaders` (all) | `privacy` (100: referrer trimming, DNT/GPC, client hints, fingerprint header reduction, third-party `Cookie` stripping), `dnr` (200) | each stage edits the same header object; a cancel stops |
| `onHeadersReceived` (`<all_urls>`) | Ghostery `adblock` (100: CSP injection), `dnr` (200) | each stage sees the previous stage's headers; changed headers are returned once |

The Electron listener of an event exists only while the event has stages: with Ghostery off and no extension
using declarativeNetRequest, no `onBeforeRequest` / `onHeadersReceived` hook is installed at all. A throwing
stage is skipped (fail open). Ghostery keeps its own library code path: `perf/adblock.ts` hands
`enableBlockingInSession` a session facade whose `webRequest.onBeforeRequest/onHeadersReceived` register
dispatcher stages, so its blocking, redirects, CSP injection and stats are unchanged. `net/domain.ts` holds the
registrable-domain heuristic shared by privacy, fingerprinting and DNR (pure, unit-testable).

## Phishing & malware protection (`src/main/safety/*`)

Electron has no Safe Browsing, so Vela checks navigations against bulk-downloaded public blocklists, entirely
locally: no URL, host or hash prefix is ever sent anywhere (unlike Google Safe Browsing's update/lookup API).

| Source | Feed | Format / matching | Threat | License |
|---|---|---|---|---|
| [URLhaus](https://urlhaus.abuse.ch/) (abuse.ch) | `downloads/text_online/` (online malware URLs) | full URL (fragment dropped) — never the whole host, since many entries are compromised legitimate sites | malware | CC0 1.0 |
| [Phishing Army](https://phishing.army/) | `phishing_army_blocklist.txt` (non-extended) | domain: exact host + parent domains down to the registrable domain | phishing | CC BY-NC 4.0 (attribution shown as "Listed by Phishing Army"; Vela is free and non-commercial) |
| [uBlock filters – Badware risks](https://github.com/uBlockOrigin/uAssets) | `filters/badware.txt` | only whole-host rules (`\|\|host^`, optionally `$doc`/`$all`/`$important`/party options); path, cosmetic, exception and type-restricted rules are skipped | badware / scams | GPL-3.0 (fetched at runtime, not redistributed) |

Not used: PhishTank (needs a registered API key per app), OpenPhish community feed (terms restrict use), the
URLhaus host file (blocks whole shared/compromised hosts).

- `lists.ts` (pure, unit-tested): sources, parsers (`urls` / `hosts` / `adblock`), `BlocklistIndex` (two `Map`s:
  URL → source, host → source). Host matching walks the host and its parent domains but stops at the
  registrable domain (`net/domain.ts`), so a listed shared suffix (`github.io`) never blocks its users.
- `index.ts`: downloads with Electron `net.fetch` 5 s after start when the cache is older than 6 h, then every
  6 h (30 s timeout, 16 MB cap per list, streamed). A download that parses to zero entries keeps the old cache.
  Cache: `userData/safety/<id>.txt` + `meta.json` (written atomically); the index is rebuilt and swapped in
  whole. Disabled (Settings → Privacy → "Warn about dangerous sites", `warnDangerousSites`, default on) means
  no checks and no downloads.
- Dispatcher stage `safety` (50, every session via `onSessionCreated`): `mainFrame` hits redirect to
  `vela://error/?threat=<malware|phishing|badware>&source=<name>&url=<original>` (the error page renders the
  warning instead of an error); `subFrame` hits are cancelled. Other resource types are not checked.
- "Back to safety" = history back (or the start page when there is no history). "Proceed anyway (unsafe)"
  calls `pages:safety-proceed`, which allowlists that exact hostname in memory until Vela quits, then navigates.
- Downloads whose URL chain is listed are flagged; the downloads "open" action only reveals them in the folder
  (same as `DANGEROUS_EXT`).
- IPC (vela:// pages only): `pages:safety-status` → `{ enabled, entries, updatedAt, sources }`.
### Tracking parameters (`src/shared/url-clean.ts`)

`cleanUrl(url)` is pure and unit-tested (`url-clean.test.ts`). It removes a curated, ClearURLs-style list:
global click/campaign ids (`utm_*`, `oly_*`, `vero_*`, `fbclid`, `gclid`, `dclid`, `gbraid`, `wbraid`, `gclsrc`,
`_gl`, `msclkid`, `yclid`, `_openstat`, `mc_eid`, `mc_cid`, `igshid`, `igsh`, HubSpot `_hsenc`/`_hsmi`/`__hs*`,
`mkt_tok`, `ttclid`, `twclid`, Matomo `pk_*` campaign keys) plus site-scoped share/attribution ids (Twitter/X
`ref_src`/`ref_url`/`s`/`t`, Spotify/YouTube `si`, YouTube `pp`/`feature`, Amazon `pd_rd_*`/`pf_rd_*`/`ref_`,
LinkedIn `trk`/`trackingId`, TikTok `_r`/`_t`/…, Reddit `share_id`, Facebook `__tn__`/`mibextid`). Affiliate and
referral parameters that pay someone or keep a page working (Amazon `tag`, generic `ref`, `aff_id`) are kept on
purpose: the list only takes ids whose sole job is attribution. The rest of the URL (other parameters, their
order and encoding, the fragment) is kept byte for byte, and a URL with nothing to remove comes back identical.

Applied in three places when Settings → Privacy → "Remove tracking parameters" is on (default): the `url-clean`
dispatcher stage redirects main-frame GET navigations to the cleaned URL only when something was removed (the
cleaner is idempotent, so the redirected request passes untouched: no loops) and adds the removed count to the
tab's blocked counter (`privacy.onTrackingStripped` → `tabs.noteBlocked`); the omnibox (`tabs.navigateTab`) cleans
before the first request; "Copy link address" copies the cleaned link (`privacy.cleanUserUrl`).

### Referrers and storage partitioning

`net/referrer.ts` (`trimReferrer`, pure, unit-tested) enforces `strict-origin-when-cross-origin` in the `privacy`
header stage when "Trim referrers" is on (default), whatever the page's Referrer-Policy says: same-site requests keep
their Referer, cross-site ones get the origin only (`https://example.com/`), https → http sends none. It only
shortens or drops the header, never loosens a stricter page policy. Only the network header changes:
`document.referrer` is computed by Blink and still follows the page's policy (Chromium's default is already
strict-origin-when-cross-origin).

Third-party storage partitioning (iframes keyed by top-level site for localStorage, IndexedDB, caches, …) is on
by default in Chromium since M115 and needs no flag. Checked on Electron 45.2.3 / Chromium 156: an iframe of site B
embedded under site A writes localStorage, and B opened top-level reads `null`.

## vela:// protocol

`vela://<page>/<file>` → `dist/renderer/pages/<page>/<file>` (default `index.html`).
`vela://shared/<file>` → `dist/renderer/shared/<file>`. Registered as privileged
(`standard`, `secure`, `supportFetchAPI`) before ready, and handled via `session.protocol.handle`
in **every** space session (hook via `onSessionCreated`). Path traversal is rejected.
Pages: `newtab`, `settings`, `error` (`vela://error/?code=…&url=…&desc=…`, or the dangerous-site warning `vela://error/?threat=…&source=…&url=…`).

## Extensions (`src/main/extensions/*`)

```
registry.ts  installed list (userData/extensions.json): id, source store|unpacked, path, enabled, spaces 'all'|ids, pinned
runtime.ts   per-Space host: electron-chrome-extensions instance + session.extensions load/unload, tab wiring, action state
webstore.ts  CWS download (electron-chrome-web-store) to userData/Extensions/<id>/<ver>_0, Omaha update checks (5 h)
manifest.ts  name/description (incl. __MSG_*__), icon data URL, options page, classified permissions
risk.ts      pure permission classifier (plain-language labels + low/medium/high), unit-tested
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
  sender-validated channels. The dispatcher owns `session.webRequest`, so extensions' blocking
  `chrome.webRequest` listeners don't fire (Electron limitation); MV3 blockers use declarativeNetRequest below.
* **`browser` namespace.** Chromium also exposes the extension API as `browser`, a separate object from `chrome`
  that the library never completes (`browser.commands`, `browser.tabs.query`, … were missing). The extension-API
  preload (`src/preload/extension-api.ts`) points `browser` at `chrome` in extension pages and service workers.

* **Permission review.** `install` / `loadUnpacked` no longer add anything: they download or validate, then
  *stage* the extension and return an `ExtensionReview` (token, plain-language permissions from `risk.ts`, overall
  risk). `confirmInstall(token)` adds it; `cancelInstall(token)` (or a 15 min timeout) drops it and deletes a
  staged store download. Host access comes from `host_permissions`, MV2 host patterns in `permissions` and
  `content_scripts[].matches`; Chrome's silent permissions (storage, alarms, …) are not listed.
* **Site access** (`siteAccess` in the registry). `all` = manifest as written. `click` is enforced: `runsIn()`
  is false until the user clicks the extension's button, so it is not loaded in any Space; the toolbar shows a
  placeholder action (manifest icon) and the first click arms it (in memory, per launch), syncs, then runs the
  normal click (popup / `action.onClicked`). Pages already open need a reload for its content scripts.
  `sites` stores a host list but is **not enforced yet**: Electron loads extensions natively and offers no hook
  to narrow content-script matches or host permissions per session; doing it would mean loading a rewritten
  copy of the extension (changes unpacked IDs) — the UI says so and points to On click / Spaces.

### declarativeNetRequest (`src/main/extensions/dnr/*`)

Electron 45 compiles in the `chrome.declarativeNetRequest` bindings but nothing behind them evaluates rules, so
MV3 blockers (uBlock Origin Lite) used to load and block nothing. Vela implements the API itself.

```
types.ts       public rule model, Chrome limits            rule.ts       validation (Chrome's errors) + compilation
pattern.ts     urlFilter / RE2 regexFilter → matchers, keys domains.ts    domain lists (suffix match)
ruleset.ts     key index (RuleIndex), merge of rulesets      matcher.ts    precedence within / across extensions
redirect.ts    url / extensionPath / transform / regexSubst  headers.ts    modifyHeaders conflict rules
request.ts     Electron details → RequestInfo               host-access.ts host permissions (match patterns)
resources.ts   redirect targets (data: for use_dynamic_url)  persist.ts    userData/dnr/<space>/<extension>.json
engine.ts      per-session state, dispatcher stages, badge   api.ts        chrome.declarativeNetRequest handlers
```

* **API surface.** The extension-API preload (registered before the library's, whose preload freezes `chrome`)
  replaces the methods of the native `chrome.declarativeNetRequest` object in place (it stays extensible: uBO
  Lite adds helpers to it). Calls go over the library's `crx-msg` channel to handlers registered on its router
  (`api.ts`), events over `crx-add-listener`. Implemented: `updateDynamicRules`/`getDynamicRules` (persisted),
  `updateSessionRules`/`getSessionRules` (memory), `updateEnabledRulesets`/`getEnabledRulesets`,
  `getAvailableStaticRuleCount`, `updateStaticRules`/`getDisabledRuleIds`, `isRegexSupported`,
  `setExtensionActionOptions` (`displayActionCountAsBadgeText`, `tabUpdate`), `getMatchedRules`
  (`declarativeNetRequestFeedback` or `activeTab`), `testMatchOutcome` and `onRuleMatchedDebug` (unpacked +
  feedback). Promise and callback forms; errors reject / set `runtime.lastError` with Chrome's wording.
* **Permissions.** `declarativeNetRequest`: block / allow / allowAllRequests / upgradeScheme everywhere,
  redirect and modifyHeaders only with host access to the request URL and its initiator.
  `declarativeNetRequestWithHostAccess`: every action needs host access. Host access = manifest
  `host_permissions` (+ MV2 URL permissions) + origins granted through `chrome.permissions.request`.
* **Matching.** Conditions: `urlFilter` (`||`, `|`, `^`, `*`, case-insensitive by default), `regexFilter` (RE2
  translated to a JS RegExp; look-around, backreferences, `\C`, `\p` and counted repeats > 1000 are rejected as
  Chrome's RE2 would), `isUrlFilterCaseSensitive`, `initiatorDomains` / `requestDomains` (+ excluded, subdomains
  included), `domainType` (registrable domain of request vs initiator), `resourceTypes` / `excludedResourceTypes`
  (default: everything but `main_frame`), `requestMethods`, session-only `tabIds` (`-1` = not a tab), and
  `responseHeaders` / `excludedResponseHeaders` (evaluated in `onHeadersReceived`). Electron types map to DNR
  types (`xhr` → `xmlhttprequest`, `cspReport` → `csp_report`, …; Electron has no `webtransport`/`webbundle`).
  Requests initiated by extensions or by the browser itself (no tab, no initiator) are not matched.
* **Precedence (Chrome's).** Per extension: highest priority; ties: allow > allowAllRequests > block >
  upgradeScheme > redirect, then session > dynamic > static. Across extensions: block > redirect/upgrade >
  allow, ties to the most recently installed extension. `allowAllRequests` matched by a frame navigation is
  recorded per `frameTreeNodeId` and acts as an allow of that priority for the frame, its sub-resources and its
  child frames. modifyHeaders rules above the extension's allow ceiling apply, newest extension and highest
  priority first; per header the first set/remove wins, appends accumulate (same-extension append after set).
* **Index.** Each rule is filed under one key, chosen at compile time: the host of a `||host^`/`||host/` filter,
  else its `requestDomains`, else its rarest bounded token (a `[a-z0-9%]` run pinned on both sides by a
  separator, so it must appear as a whole URL token; common tokens like `com`, `js`, `https` are avoided), else
  its `initiatorDomains`, else a short generic list. All enabled static rulesets of an extension are merged into
  one index, so a request costs one map lookup per key per extension (host suffixes, URL tokens, initiator
  suffixes). urlFilters without anchors/wildcards are substring tests; others compile to a RegExp lazily on
  first use, behind a literal pre-check. Tokens are dropped after indexing.
* **Lifecycle.** `runtime.ts` loads an extension's DNR state right after Chromium loaded it: enabled rulesets
  (persisted; reset to the manifest flags when the version changes, as Chrome does on update) are read and
  compiled with event-loop yields between rulesets, inside the Space's first-load gate, so the first page is
  already filtered. The engine adds its dispatcher stages to a session only while an extension with a DNR
  permission is loaded there. Removing an extension deletes its `userData/dnr/*/<id>.json`.
* **Redirects.** `extensionPath` targets listed in `web_accessible_resources` with `use_dynamic_url: true`
  (uBO Lite's surrogate scripts) are served as `data:` URLs for sub-resources: Electron has no per-session
  dynamic extension URL and blocks the static one. Frames keep the `chrome-extension://` URL.
* **Badge.** With `displayActionCountAsBadgeText`, block / redirect / upgrade actions per tab are shown as the
  action's badge text (through the library's `browserAction.setBadgeText`, coalesced every 250 ms) and reset on
  each top-level navigation.
* **Ghostery + DNR.** Both run: Ghostery's stage first (its stats and perf-chip counter stay its own), then
  the extensions'. A request either blocks stays blocked. Users of uBO Lite may turn Ghostery off in Settings.
* **Cost.** uBO Lite's default rulesets (~19–21k rules) compile in ~0.15–0.45 s at Space startup (inside the
  first-load gate), take ~27 MB of V8 heap and cost ~6–10 µs per request (node benchmark on the real rulesets;
  all 56 rulesets / 70k rules: ~25 µs). The header phases reuse the request phase's matches.
* **Not implemented / differences.** No global static-rule pool shared between extensions (each extension may
  enable up to Chrome's 30k guaranteed + 300k pool), no `topDomains` condition, no `getMatchedRules` quota
  throttling, static regex rules beyond Chrome's 1000 per ruleset are not dropped, `onRuleMatchedDebug` reports
  `frameId: -1`, and `activeTab` is treated as granted for `getMatchedRules`.

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

## Android

`android/` is a separate, native app (Kotlin + Jetpack Compose, Gradle) — no code is shared with the Electron app,
the concepts are. Engine: Android System WebView via `androidx.webkit`. Details: [android/README.md](../android/README.md).

* **Spaces** map to WebView **Profiles** (`ProfileStore`, `WebViewCompat.setProfile`, feature `MULTI_PROFILE`):
  `space-<id>` for regular Spaces, `burner-<id>` for Burners (deleted on close, swept at startup). Without
  `MULTI_PROFILE` all Spaces share the default profile and Burners are disabled.
* **Tabs**: one WebView per awake tab, only the active one attached; idle/excess/memory-pressure tabs sleep
  (WebView destroyed, back stack kept in memory). New tab pages are native Compose. Session (Spaces, tabs) is JSON
  in app storage; Burner tabs are never persisted.
* **UI**: a floating bottom island (back/forward, omnibox, tabs, menu) that collapses while reading, plus sheets
  for Spaces, menu, context menu and permission prompts — the desktop "Floating Islands" tokens mapped to Compose.
* **Blocking**: `ContentBlocker` seam called from `shouldInterceptRequest`; the engine is the pure-Kotlin `android/adblock`
  module. Filter lists are downloaded (not bundled) and kept as a compiled snapshot (`FilterLists`); the
  built-in host list covers the first run. The logo is generated from `src/shared/brand-mark.ts` (`android/scripts/brand-mark.mjs`).

## Build

`scripts/build.mjs` (esbuild): main → `dist/main/index.js` (cjs, node), preloads → `dist/preload/*.js`
(cjs, sandboxed: only `electron` import allowed), renderer entries → iife, static files copied.
`npm run dev` = build + launch, `npm run typecheck` = `tsc --noEmit`.

Brand: `src/shared/brand-mark.ts` holds the logo's path data and app-icon tile; the renderer imports it
(Settings `VelaMark` / `VelaAppIcon`, new-tab `LogoHero`, vela:// favicons) and `npm run icons`
(`scripts/icons.mjs`, offscreen Electron) generates `build/icon.svg`, `icon-mono.svg`, the PNG set,
`icon.ico` and `icon.icns` from it. Unpackaged runs set the window icon from `build/` (`devWindowIcon`
in `window.ts`); packaged builds take it from the executable.

## Security hardening

### Electron fuses (`electronFuses` in `electron-builder.yml`)

electron-builder flips these in the packaged executable (after embedding the asar header hash as a
Windows resource / macOS `ElectronAsarIntegrity` plist key). Unpackaged `npm run dev` runs are unaffected.

| Fuse | Value | Why |
|---|---|---|
| `RunAsNode` | off | `ELECTRON_RUN_AS_NODE` would turn `Vela.exe` into a plain Node.js (a signed LOLBin). Vela never forks the main process (no `process.fork`; use `utilityProcess` if ever needed). |
| `EnableNodeOptionsEnvironmentVariable` | off | `NODE_OPTIONS` / `NODE_EXTRA_CA_CERTS` could inject code or CAs into the main process. |
| `EnableNodeCliInspectArguments` | off | `--inspect*` / `SIGUSR1` would expose a debugger on the main process. |
| `EnableEmbeddedAsarIntegrityValidation` | on | `app.asar` is checked against the hash baked into the executable (Windows since Electron 30, macOS). |
| `OnlyLoadAppFromAsar` | on | No fallback to an `app/` folder or `default_app.asar`, so integrity validation cannot be sidestepped. |
| `EnableCookieEncryption` | on | Cookie values are encrypted at rest with the OS key (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux), like Chrome. |
| `GrantFileProtocolExtraPrivileges` | **on** (default) | The chrome UI is loaded via `file://` (`window.ts` → `dist/renderer/chrome/index.html`); its ES-module chunks (`dist/renderer/assets/`) and `@font-face` fonts are CORS-mode loads that rely on these privileges. Turning it off needs the chrome UI moved to a privileged custom scheme first. Web content never runs on `file://` with Node, and tabs are separate sandboxed views. |
| `LoadBrowserProcessSpecificV8Snapshot` | default (off) | Not used. |

**Cookie encryption migration.** Chromium's `os_crypt` reads both plaintext and encrypted (`v10`-prefixed)
cookie values, so existing profiles keep their logins: old plaintext cookies stay readable and are
re-written encrypted as sites update them. The transition is one-way — a build *without* the fuse cannot
read encrypted cookies, so downgrading to a pre-fuse Vela (≤ 0.6.0) silently loses those cookies (sites
log out; nothing else breaks). The encryption key lives in `userData/Local State` (`os_crypt.encrypted_key`),
so copying a profile to another Windows account or machine also loses cookies, as in Chrome.

Verify a build: `node -e "require('@electron/fuses').getCurrentFuseWire('<exe>').then(console.log)"`
(`@electron/fuses` is already a transitive dependency of electron-builder).

### Mark-of-the-Web on downloads (`src/main/zone-identifier.ts`)

On Windows every completed download gets a `Zone.Identifier` alternate data stream
(`[ZoneTransfer]` / `ZoneId=3` / `ReferrerUrl` / `HostUrl`, CRLF), written by `downloads.ts` after the
`done` event, so SmartScreen, Defender, Office Protected View and the "Unblock" checkbox treat the file
like a Chrome/Edge download. `HostUrl` is the last URL of the redirect chain, `ReferrerUrl` the page that
started the download. Only http(s) URLs are recorded (credentials and fragment stripped); `blob:`,
`data:`, `vela://` etc. and every download from a non-persistent (burner) session get the zone line only.
Writing is best effort: volumes without ADS support (FAT32/exFAT, some shares) simply get no mark.
