# Changelog

All notable changes to Vela are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Clicking an inactive tab (or split pane) only switches to it; the command palette opens only when clicking the tab that was already active, and never after a drag.
- The start page can no longer be closed when it is the only tab of a Space: it has no close button, and Ctrl+W, middle-click and the context menu's Close do nothing. Closing the last tab that shows a website still turns it into the start page.

## [0.5.0] - 2026-11-10

### Added
- MantelVPN integration: the VPN panel shows the official Mantel mark and brand green, signs in with the 16-digit Mantel account number (grouped in fours, pastes with spaces or dashes work), shows the real paid-until date and the live Mantel location list. Connect routes the active Space through an account-scoped Mantel HTTP proxy on the chosen location (proxy password answered by Vela, other Spaces stay direct; the Space's previous proxy comes back on disconnect, sign-out or restart). The account number and proxy passwords are stored only with OS-encrypted safeStorage. When Mantel is unreachable the panel falls back to clearly marked preview data
- VPN panel (preview, not yet connected to a real VPN): MantelVPN partner card with license activation, account expiry, server picker and a simulated connection; Mullvad and Proton VPN listed as coming soon

### Changed
- Horizontal tab strip: the active tab is now a normal tab with the same width as the others instead of a wide address bar; widths only change when tabs are added or removed. The address, connection security and blocked-request count appear in the omnibox when you click the active tab.

### Fixed
- The active tab (and the focused pane of a split) can be closed with its close button, which is always visible on it; middle-click closes any tab.
- Windows: dragging the window to a screen edge now snaps (top = maximize, left/right = half
  screen) with the "None" window material too. Electron gives transparent windows no thick frame,
  so native Snap is off there and Vela emulates the drag-to-edge part.

## [0.4.1] - 2026-11-10

### Fixed

- Audio mixer: a tab that is playing but was never adjusted no longer says "No sound yet"; it shows live meters
  while the mixer is open.
- Audio mixer: the first change on a YouTube video that is already playing now applies immediately. Before, the
  live install crashed on the page's patched `Function.prototype.toString` and nothing was processed until reload.
- Audio mixer: sound that was already playing when the first change came in (a running page AudioContext, a
  detached `new Audio()`, media inside a shadow root) is now taken over live. If it still can't be reached, the
  mixer says "Reload to apply" and offers a reload button instead of failing without a message.
- Audio mixer: the routing status now follows playback starting and stopping and goes back to neutral when the
  settings are reset.

## [0.4.0] - 2026-11-10

### Added
- Extensions: `chrome.declarativeNetRequest`. Static rulesets (enable / disable, individual static rules), dynamic
  rules (kept across restarts, per Space) and session rules; block, allow, allowAllRequests, upgradeScheme,
  redirect (URL, extension resource, URL transform, regex substitution) and modifyHeaders with Chrome's priority
  and precedence rules; rule-count badges, `getMatchedRules`, `isRegexSupported` and `testMatchOutcome`.
  uBlock Origin Lite now blocks ads and trackers, including its filtering modes and per-site exceptions. Rules
  are indexed per extension (uBO Lite's ~20k default rules compile in about 0.2–0.4 s at startup; matching
  costs a few microseconds per request).
- Settings → Performance → **Frame rate** (Windows): *Match display* (default), *Highest* or *Primary display*, with
  the detected displays and their refresh rates, the frame rate the page actually gets, and "Restart to apply".
  Frame caps and an "unlimited" mode are not offered: Chromium has no clean on-screen cap, and uncapping measured
  slower (~59 fps).
- Android: Settings → Display → **Refresh rate**: *Auto* (the system decides, Vela asks for the fastest rate while
  you scroll, fling or something animates), *High* (always the fastest mode, e.g. 120 Hz) or *Standard* (60 Hz,
  saves battery), showing the rates the screen supports and the current one.
- **Audio mixer** (`Ctrl+Shift+M`, the mixer button in the toolbar or "Audio mixer" in the palette): a channel
  strip per tab with sound (volume 0–200 % with a 100 % detent, balance, mute, solo, live stereo meters with peak
  hold, jump to tab) and, for the selected tab, a 10-band equalizer drawn as its real frequency response over the
  live spectrum, presets (Flat, Bass, Vocal, Treble, Loudness, Podcast, Night), bass boost with gain and corner
  frequency, mono, "Even out volume" and the tab's speaker and microphone. The toolbar button shows when something
  is playing.
- Per-tab audio mixer engine: volume up to 200 %, balance, mono, a 10-band equalizer with presets, bass boost and a gentle compressor for every tab, applied live to media elements, Web Audio and WebRTC playback (iframes included) and restored with the session. Boosts go through a limiter, so they don't clip harshly. Cross-origin media that Web Audio cannot read is never silenced: it only gets the tab volume. Works together with per-tab audio devices. Tabs without mixer settings pay nothing.
- **Fingerprint protection inside workers**: dedicated, module, blob/data, nested, shared and service workers now
  report the same hardware buckets, GPU model, canvas/WebGL noise (`OffscreenCanvas`, `readPixels`) and (Strict)
  reduced client hints as the page that runs them, so fingerprinting scripts no longer see a window/worker mismatch
  ("hardwareConcurrency does not match worker scope"). Workers are patched before their first line runs, without
  rewriting their scripts, so module imports, `importScripts`, relative URLs and CSP behave as before. Starting a
  worker takes about 2–3 ms longer in protected Spaces; Spaces with protection off are untouched.

### Changed
- All `webRequest` hooks of a Space (built-in blocker, privacy headers, extension rules) now run through one
  ordered pipeline per session, since Electron allows a single listener per event. Behavior is unchanged.

### Fixed
- Extensions that use the `browser` namespace (e.g. uBlock Origin Lite) crashed at startup because
  `browser.commands` and other APIs were missing; `browser` now refers to the complete `chrome` object.
- Vela no longer runs at the primary monitor's refresh rate on a faster second display (Windows): with a 144 Hz
  laptop panel next to a 75 Hz primary monitor it drew at 75 fps, now at 144 fps.
- Android: smoother tab switcher, settings and history: the page underneath stops drawing once the panel covers it,
  tab thumbnails are decoded as hardware bitmaps, and the loading bar no longer recomposes the island on every frame.
- `window.chrome` (`app`, `csi`, `loadTimes`) was missing in same-origin child frames that are not loaded from the
  network (a new iframe's `about:blank`, `srcdoc`, `document.write`), a classic embedded-browser check.

## [0.3.0] - 2026-11-09

### Added
- **Vela for Android** (`android/`): a native Kotlin + Jetpack Compose browser on Android System WebView. Floating
  bottom island that tucks away while reading, tab switcher with swipe-to-close, sleeping tabs and lazy session
  restore, Spaces isolated through WebView profiles, Burner spaces wiped on close, the desktop-style new tab page
  (tap the clock to cycle styles), history, settings, downloads, in-app permission prompts and privacy defaults
  (HTTPS-only, third-party cookies blocked, DNT/GPC, Safe Browsing). CI builds, tests and lints it; `v*` tags
  produce a release APK.
- Android: real ad and tracker blocking with EasyList, EasyPrivacy and Peter Lowe's list (the pure-Kotlin
  `android/adblock` engine). The lists are downloaded on first run and refreshed every 4 days rather than bundled,
  compiled off the main thread and kept as a snapshot that later starts load in a fraction of a second; a small
  built-in list covers the time until then. Settings → Ad blocking shows the filter count, last update and
  "Update now".
- Android: find in page (compact island with match count and previous/next), "Desktop site" per tab, drag tabs
  to reorder in the switcher (long-press), popups and new-tab children return to their opener when closed, and
  `blob:`/`data:` downloads (saved to Downloads under the link's `download` name).
### Changed
- Android matches the desktop look: the new sail logo (launcher, themed icon, splash, new tab, About; generated
  from `src/shared/brand-mark.ts`), Geist as the UI font, and the accent follows the active Space with the default
  Space in desktop blue. Top sites show cached favicons and correct placeholder letters (W for en.wikipedia.org, Y
  for m.youtube.com). Islands stay above the keyboard, and blocked requests are counted once per URL.
- New Vela logo: a sail cut by one slanted gap into an accent cap and a white body, like two floating islands. It replaces both the old constellation icon and the different sail glyph Settings → About used, so the taskbar, window, installer, About page, new-tab logo hero and the Settings/History tab favicons now show the same mark. The window icon is also set when running unpackaged (`npm run dev`), so it no longer shows Electron's icon. Windows builds ship a multi-size `.ico` (16–256) and macOS builds a squircle `.icns` with Apple's margin; all of it is generated from one source by `npm run icons`.

### Fixed
- Signing in with Google failed with "Couldn't sign you in – This browser or app may not be secure", because Vela still looked like an embedded Electron browser. Vela now presents one consistent Chromium identity in every Space (fingerprint protection on or off): the User-Agent carries the frozen `Chrome/<major>.0.0.0` version like every Chromium browser instead of the full build number; `window.chrome` has `app`, `csi` and `loadTimes` (it was empty); navigations now send the `Sec-CH-UA`, `Sec-CH-UA-Mobile` and `Sec-CH-UA-Platform` headers that Chromium sends to every secure site (only subresources had them); Google's account pages get the detailed client hints they ask for, with the same values `navigator.userAgentData` reports (reduced in Strict Spaces); and `Accept-Language` now matches `navigator.languages`. This also covers "Sign in with Google" popups from other sites.
- Sign-in pages no longer open the Windows Hello / passkey dialog by themselves on load. Passkey autofill (conditional mediation) is reported as unavailable, because Vela has no autofill menu to show it in; signing in with a passkey via the site's button still works.

## [0.2.1] - 2026-11-09

### Added
- Per-tab audio devices: pick the speakers/headphones a tab plays on and the microphone (and camera) it records from, under "Audio devices" in the tab menu, from the tab's speaker/microphone indicator (a small Sound popover with mute) or the command palette. Routing applies live to media elements, Web Audio and WebRTC playback, including iframes; capture still goes through the permission prompt. Choices are restored with the session; an unplugged device falls back to the system default (marked in the tab) and is used again once it returns. Tabs on "System default" pay nothing.

### Fixed
- Submenus in the tab context menu ("Add to group", "Move to Space") never appeared, so a tab could not be added to an existing group or moved to another Space from the menu. All context-menu and dropdown submenus now float beside their menu, stay inside the window (scrolling when the list is long) and work with the keyboard.

## [0.2.0] - 2026-11-09

### Added
- **Per-space fingerprint protection** (Off / Standard / Strict, per Space; new Spaces default to Standard, Burners to Strict).
  Each Space gets a random seed; canvas, WebGL and audio readbacks get subtle noise derived from (seed, site), so a
  site sees a stable fingerprint across reloads but a different one in every Space. Hardware (cores, memory, GPU model)
  is generalized, the battery reads as plugged in and WebRTC never leaks local addresses (no UDP outside a proxy in
  Strict or proxied Spaces). Strict also buckets the screen size and reduces client hints and media-device labels.
  "New fingerprint" in the Space dialog and Settings → Spaces rotates the seed.
- Chrome extensions: install from the Chrome Web Store by link or ID (with background updates) or load an unpacked folder, enable/disable/remove them in Settings → Extensions, choose the Spaces each one runs in, and pin action buttons (with badges and popups) to the top island. Nothing extension-related loads until an extension is installed.
- Tab groups: named, colored, collapsible groups per Space. Create them from the tab context menu or the command palette, drag tabs in and out, drag groups to reorder; rename, recolor, ungroup or close a group from its menu. Groups are restored with the session.
- Vertical tab layout (Settings → Appearance, `Ctrl+Shift+,`): a floating tab island on the left with pinned tabs as an icon grid and groups as collapsible sections. Resize it by dragging its edge, fold it to an icon rail (hover to peek).
- Command palette: "New tab group", "Tab layout", "Collapse / Expand all groups".
- Split view: show two tabs side by side (up to four, 2×2) with a draggable, persisted divider. Click a pane to focus it; the focused pane drives the address bar, navigation, find, zoom and shortcuts. Start a split by dragging a tab onto the left or right edge of the page, from the tab menu ("Split with current tab", "Open in split view with…"), the command palette or `Ctrl+Shift+D`; hover the top of a pane for swap / close split / close tab. Split tabs are shown joined in both tab layouts, stay together in tab groups, never sleep while visible, and are restored with the session.
- Optional end-to-end encrypted sync (Settings → Sync), off by default. Syncs settings, Spaces (name, color, proxy), open tabs (shown as "Other devices" in the command palette) and, if enabled, history through a folder you choose or a WebDAV server. Passphrase-derived key (scrypt) + AES-256-GCM, recovery key, no Vela-operated server.
- Auto-update via GitHub releases: checks 10 s after startup and every 6 hours, downloads in the background and
  installs on restart. An "Update ready · Restart" chip appears in the top island; release notes open from the chip
  or from Settings → About → Updates, which also has "Check now", automatic download and pre-release options.
  The Windows portable build, `.deb` packages and unsigned macOS builds only notify and link the release page.
- `VELA_UPDATE_FEED=<url|dir>` points the updater at a generic feed for local testing.

### Changed
- macOS releases also ship a `.zip` (what the updater installs from once builds are signed).

## [0.1.1] - 2026-11-09

### Added
- Switchable start page: click the clock to cycle clock, clock with seconds, Vela logo, date, greeting and minimal (also in Settings → Appearance).

### Changed
- Memory readout now shows private memory (what Task Manager shows) instead of summed working sets, which double-counted shared pages.
- "Saved by sleeping" is measured per tab at sleep time.
- The window no longer keeps an idle renderer process alive (BaseWindow).
- New tab: static background instead of animated blurred layers; no perpetual animations while idle (idle CPU and GPU usage near zero).
- Lighter fonts (Latin subsets), lazy-loaded dialogs; `npm run dev` ships production React.

## [0.1.0] - 2026-11-09

First public preview.

### Added

- **Spaces** — isolated browsing contexts, each backed by its own Chromium session partition with separate
  cookies, storage, cache, service workers, logins and permissions, plus an optional per-space proxy.
- **Burner spaces** — in-memory spaces whose data is wiped when the space is closed or Vela quits.
- "Floating Islands" UI: detached glass top toolbar over Mica/Acrylic, active tab as omnibox morphing into
  the command palette, focus mode, animated tab strip with pinning, muting and moving tabs between spaces.
- Command palette (`Ctrl+K`) combining navigation, history and top-site suggestions, and commands.
- Find-in-page bar, zoom controls, downloads, fullscreen and DevTools.
- Built-in network-level ad and tracker blocking powered by the Ghostery adblocker engine.
- Tab sleeping: inactive tabs have their renderer destroyed after a configurable delay, or earlier under
  memory pressure, and reload on demand.
- Lazy session restore: restored tabs stay asleep until first activated.
- Preconnect on suggestion hover to shorten time to first byte.
- Curated Chromium flags for a lean, quiet runtime.
- Privacy defaults: cleaned user agent, permissions denied by default, optional Do Not Track / GPC headers,
  HTTPS-only upgrades, optional third-party cookie blocking.
- Privileged `vela://` pages: new tab, settings and error pages.
- Release builds for Windows (NSIS installer, portable), macOS (dmg, arm64 and x64) and Linux (AppImage, deb).

[Unreleased]: https://github.com/Aepzie/vela/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Aepzie/vela/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Aepzie/vela/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Aepzie/vela/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Aepzie/vela/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Aepzie/vela/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Aepzie/vela/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/Aepzie/vela/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Aepzie/vela/releases/tag/v0.1.0
