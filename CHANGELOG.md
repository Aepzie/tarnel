# Changelog

All notable changes to Vela are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Settings → Performance → **Frame rate** (Windows): *Match display* (default), *Highest* or *Primary display*, with
  the detected displays and their refresh rates, the frame rate the page actually gets, and "Restart to apply".
  Frame caps and an "unlimited" mode are not offered: Chromium has no clean on-screen cap, and uncapping measured
  slower (~59 fps).
- Android: Settings → Display → **Refresh rate**: *Auto* (the system decides, Vela asks for the fastest rate while
  you scroll, fling or something animates), *High* (always the fastest mode, e.g. 120 Hz) or *Standard* (60 Hz,
  saves battery), showing the rates the screen supports and the current one.

### Fixed
- Vela no longer runs at the primary monitor's refresh rate on a faster second display (Windows): with a 144 Hz
  laptop panel next to a 75 Hz primary monitor it drew at 75 fps, now at 144 fps.
- Android: smoother tab switcher, settings and history: the page underneath stops drawing once the panel covers it,
  tab thumbnails are decoded as hardware bitmaps, and the loading bar no longer recomposes the island on every frame.

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

[Unreleased]: https://github.com/Aepzie/vela/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Aepzie/vela/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Aepzie/vela/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Aepzie/vela/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/Aepzie/vela/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Aepzie/vela/releases/tag/v0.1.0
