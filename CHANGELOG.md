# Changelog

All notable changes to Tarnel (called Vela up to 0.9.1) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- The ad blocker now catches more ad, tracking and telemetry hosts the public lists miss (mobile and audio ad networks, PostHog, Snowplow, X/Reddit/Quora pixels, Microsoft and Amazon device telemetry, a redirect-malware host), plus bait checks on the common adblock test pages.

## [0.10.0] - 2026-11-13

### Added
- Offline error pages offer an optional game, Trail hop, to play while you wait. It loads only when opened, pauses when hidden, and never shows on security warnings. (thanks raluev)
- New logo: a mountain over a still lake, its reflection drawn as three accent bands. App icons, installers, the About page, the new-tab logo and internal-page favicons all use it.
- `tarnel://` is the address of the internal pages (`tarnel://settings`, `tarnel://newtab`, `tarnel://privacy`, …).
- Settings → Privacy → Protected content (DRM), off by default. Needs a DRM-capable build; release builds don't include one yet.

### Changed
- Vela is now Tarnel: new name and logo. Existing profiles, settings and vela:// links carry over automatically.
- `vela://` addresses keep working as an alias and open the same `tarnel://` page, so old bookmarks, history and restored tabs still work.
- Windows: installer, shortcuts and Default apps entry are now called Tarnel (`Tarnel-<version>-setup-x64.exe`); updating removes the old Vela registrations so Windows doesn't list two browsers.
- The profile folder moves from `Vela` to `Tarnel` on first start (moved, or copied if moving fails; nothing is deleted). For isolated test instances use `TARNEL_USER_DATA` (`VELA_USER_DATA` still works).
- The project now lives at https://github.com/Aepzie/tarnel.
- Ad blocking takes the uBlock Origin lists straight from uBlock Origin (including the 2025/2026 lists) instead of Ghostery's weeks-old copy, so new YouTube ad fixes arrive within a day. Falls back to Ghostery's copy if uBlock Origin's site is unreachable.

### Fixed
- "New fingerprint" now changes every seed-based value: CPU cores, memory and GPU model no longer stay the same by chance, and ClientRects (`getBoundingClientRect` / `getClientRects`) are now protected too, so their hash changes with the fingerprint. (thanks calebsexy)
- ClientRects protection: `JSON.stringify` of a measured `DOMRect` (its `toJSON`) now returns the same scaled values as its getters instead of the unscaled ones, so the protection can no longer be detected or bypassed that way.
- Ad blocking now also blocks ad-SDK, analytics and device-maker telemetry hosts (Unity Ads, Yahoo, Yandex, TikTok/ByteDance, Xiaomi, Oppo/Realme, Huawei, Apple) through a small list bundled with Tarnel. adblock.turtlecute.org now scores 100% (was 69%).
- A cached ad-block engine could fail to load at startup ("start offset of Uint32Array should be a multiple of 4") and was rebuilt from the network on every launch, depending on the length of its cache key.
- YouTube ads are blocked again: ad-blocking scriptlets now run before the page's own scripts (also in YouTube embeds), so ad data is removed before the player reads it. Each scriptlet still runs only once per page.

### Security
- Sync settings import accepts only known, syncable keys and builds patches without a prototype, preventing crafted remote records from overriding device-local DRM consent indirectly.

## [0.9.1] - 2026-11-11

### Added
- Open local files in tabs: PDF (Chromium's PDF viewer), HTML, images, SVG, text, JSON, audio and video. Paths on the command line ("Open with", double-click, `vela C:\pathile.pdf`, relative paths, `file://` URLs, a bare `--` before targets) and macOS `open-file` / `open-url` open in new tabs; tabs of untitled files show the file name.
- Drag and drop: files or links dropped on the tab strip, vertical tab list or other browser UI open in new tabs (subtle accent ring while dragging); drops on the new-tab page or a local file open next to it, links dropped on a web page open in a new tab.
- Default browser: Settings → General shows whether Vela is your default browser and has a "Make default" button (on Windows it opens Settings → Default apps on Vela's page; on macOS and Linux it sets it directly). The Windows installer now registers Vela as a full browser, so it appears in Default apps and in "Open with" for web links, HTML, XHTML, MHTML, PDF, SVG and WebP files, without taking any file type over. The portable version can't be the default browser.

### Changed
- README: shorter and focused, with a demo recording of the real app at the top (`docs/media/vela-demo.gif`, full quality as `vela-demo.mp4`). The complete feature list, all keyboard shortcuts, the Spaces details, performance notes and the security model moved to the new [docs/FEATURES.md](docs/FEATURES.md); features missing from the old README (VPN, passwords, translation, site rules, privacy report, cookie banners and more) are listed there now.

### Fixed
- Clock seconds keep each digit fully visible instead of inheriting the main time’s negative letter spacing.
- The new-tab background fills the whole page without reserving an unused scrollbar gutter.
- Vertical tab lists have clear inner spacing, and pinned tiles fit the collapsed rail.
- Segmented controls use consistent padding and concentric selection corners in light and dark themes.
- Toolbar and caption buttons use the shared 10px radius token.

### Security
- Web pages can never navigate, frame or open `file://`; only the user, other local files and Vela's own pages can. Local files never get the `window.vela` / `window.velaPages` bridges.

## [0.9.0] - 2026-11-11

### Added
- Privacy report: rejected cookie banners are counted and shown as a weekly tile (replaces the referrer tile; referrers stay in the per-Space line).
- Screenshots (Ctrl+Shift+X, "Screenshot" in the command palette, or "Take screenshot" in the page context menu): drag an area over the frozen page, or take the visible part or the full page (long pages are cut at 16,000 px). The editor offers crop, arrow, rectangle, pen, text, highlighter and blur (pixelate) to hide personal data, six colours, undo/redo and zoom; copy to the clipboard or save as PNG or JPEG (`Vela screenshot <date>.png` by default).
- Web panels: pin web apps (WhatsApp Web, Telegram, Discord, Spotify, a calendar, any URL) to a slim rail on the right edge and open them as a resizable side view next to the page. Each panel has its own isolated session, an optional mobile layout, an unread badge from the page title and a menu to reload, mute, change the URL, open as a tab or remove it. Collapsed panels stay signed in and follow the tab freeze/sleep timeouts (never while playing sound). Settings → Appearance → Web panels.
- Reject cookie banners (Settings → Privacy, on by default): consent pop-ups from common consent tools (OneTrust, Sourcepoint, Didomi, Cookiebot, Usercentrics, Google's consent page and more) are answered with "reject" / "only necessary" and hidden. Built on DuckDuckGo's autoconsent rules (MPL-2.0), bundled at build time — nothing is fetched or sent. The site-info popover shows how many banners were rejected on the page and can allow banners on a site; exceptions are listed in Settings → Privacy.
- On-device page translation: pages are translated locally with Mozilla's Firefox Translations engine (Bergamot) and models; no page text leaves the device. Models (~37 MB per direction) are downloaded on demand, SHA-256 verified, and can be deleted. Translate button in the address popup when the page language differs, palette command "Translate page" / "Show original page", and Settings → General → Languages (target language, always translate, downloaded models). 109 directions (every language ↔ English; other pairs pivot through English).
- Site rules (Settings → Rules): connect a domain card (`example.com`, `*.example.com` or a wildcard like `shop-*.example.*`) to actions — open in a Space, route through a MantelVPN country, fingerprint level (off / standard / strict / random per visit), user agent, or block the site. Applied before the page loads, also for link clicks and new tabs. A workflow editor (drag cards, connect them; fully usable by keyboard) plus a plain list view and a "Which rules apply to…" tester. The tab menu has "Create rule for this site…". When a VPN rule can't apply because you're signed out, a short hint appears.
- Peek: shift-click a link (or "Open in Peek" in the page menu, or "Peek" in the address bar) to preview it in a floating window over the page, in the same Space and VPN route. Back, reload, "Open as tab" (keeps the page, no reload), "Open in split view" and close; Esc or a click on the dimmed page closes it. Toggle in Settings → General.
- Email aliases (Settings → Privacy): connect SimpleLogin or addy.io with an API key and Vela offers "Use an alias for <site>?" when you focus the email field of a sign-up form. The alias is created only after your click, filled into that field, and kept with the login if you save the password (shown in vela://passwords with a link to manage it). The key is encrypted by your OS and never shown to pages.
- Privacy report (`vela://privacy`, Settings → Privacy → Privacy report, or "Privacy report" in the command palette): this week vs last week for trackers and ads blocked (Vela's blocker and extension rules), tracking parameters removed, referrers trimmed and dangerous sites warned, with estimated data and time saved, the tracker domains and companies that tried to track you most, and a per-Space breakdown. Counted on this device only as daily totals (tracker domains only, never the pages you visited), kept for 90 days; "Reset stats" clears them. Burner Spaces count towards the totals only.
- Start page: a small "N trackers blocked this week" line that opens the report (Settings → Appearance → Start page → Privacy stat, on by default).
- Optional weekly summary notification (Settings → Privacy → Weekly summary, off by default).
- Tab archive: tabs unused for a while (Settings → Performance: Off / 6 h / 12 h / 24 h / 3 days / 1 week, default 24 h) move into a per-Space archive with URL, title, favicon, group and time; pinned tabs, tabs playing audio, using the mic/camera or downloading are never archived, Burner Spaces keep their archive in memory only. `Ctrl+Shift+E`, "Move to archive", "Archive other tabs" and "Archive group" archive by hand. The archive view (archive button in the tab strip / vertical list, palette command "Tab archive") has search, days, restore (into its Space and group), restore all of a day, delete and clear, plus the Space's recently closed tabs. Address-bar suggestions include archived tabs ("Archived · 2 days ago").
- Battery saver (Settings → Performance): Off, On battery (default), Below 20 % or Always. While on, background tabs freeze and sleep twice as fast, the memory saver acts as Maximum, address-bar preloading is skipped, adblock lists refresh less often, the perf chip stops polling and shows a leaf, and the browser's own animations are calmed. Security features are never reduced.

### Changed
- The "halve freeze/sleep delays on battery" rule now follows the Battery saver setting (it can be turned off).

### Fixed
- YouTube videos sometimes stayed black, never started or showed "Video unavailable" with the content blocker on: its cosmetic scriptlets ran in one shared scope and broke each other (and the player's JSON / network calls). Each scriptlet now runs in its own scope.

## [0.8.3] - 2026-11-11

Includes the changes from 0.8.1 and 0.8.2, which were withdrawn.

### Added
- User agent per Space: a default in Settings → Privacy and an override in each Space (Settings → Spaces). Pick from a list of common browsers (Chrome, Edge, Firefox, Safari on desktop and mobile) or randomize.

### Fixed
- The memory number in the perf chip, its popover and the task manager now matches Windows Task Manager (private working set). It showed private commit before, ~30% higher. macOS/Linux unchanged; the memory saver still uses private commit.
- Dropdown lists were white in the dark theme: Spaces timezone/language/user agent and the passwords Space picker now use Vela's own themed select.
- Settings and other vela:// pages no longer shift sideways when switching between short and long sections (the scrollbar's space is always reserved).

## [0.8.0] - 2026-11-10

### Added
- Import from other browsers (Settings → Import): bookmarks and recent history from Chrome, Edge, Brave, Vivaldi, Opera, Chromium and Firefox profiles on Windows, macOS and Linux, into the Space you choose. Passwords come from the CSV file those browsers, Bitwarden or 1Password export; the file is read in the main process and never shown to pages. A fresh new tab page offers a small, dismissible "Import from Chrome" hint
- Bookmarks, per Space: star next to the address in the command palette or Ctrl+D bookmarks the page and opens a small editor (name, folder, remove). Every Space has "Bookmarks bar" and "Other bookmarks"; Burner Spaces keep bookmarks in memory only.
- Optional bookmarks bar under the toolbar (Settings → Appearance → Show bookmarks bar, Ctrl+Shift+B), with folder dropdowns, an overflow menu and drag to reorder.
- vela://bookmarks: folder tree, search, add, edit, delete, drag and drop, and "Import bookmarks…".
- Bookmarks appear in address-bar suggestions and the command palette ("Bookmarks", "Bookmark this page", "Toggle bookmarks bar").
- Extensions store at `vela://extensions`: a curated, privacy-first catalog (uBlock Origin Lite, Privacy Badger, Bitwarden, Proton Pass, Dark Reader, SponsorBlock, React DevTools and more) with install, enable/disable, options and remove, an Installed view, a filter and a "Search the Chrome Web Store" shortcut. Every install still goes through the permission review.
- "Add to Vela" button in the toolbar while a Chrome Web Store extension page is open.
- "Browse extensions" in the extensions menu and Settings → Extensions, and an "Extensions store" palette command.
- Built-in password manager, per Space: Vela offers to save (or update) a password after you sign in, and offers saved accounts on sign-in forms. Nothing is filled until you pick an account. Passwords are encrypted with your OS (DPAPI, Keychain or a Linux keyring); if that is not available Vela does not save them. Burner Spaces keep passwords in memory only.
- vela://passwords: search, reveal (with a confirm, hidden again after 30 s), copy (cleared from the clipboard after 30 s), edit, delete, CSV export, "Never saved" sites, and a shortcut to install Bitwarden or 1Password instead.
- Settings → Privacy → Passwords: "Offer to save passwords" and "Auto-fill" switches.

## [0.7.1] - 2026-11-10

First published build of the 0.7 line (the v0.7.0 tag was never released because its macOS packaging failed in CI).

### Fixed
- Release CI: unused signing secrets no longer break macOS packaging.

## [0.7.0] - 2026-11-10 (not released)

### Added
- Freeze background tabs (Settings → Performance, default 5 min): idle background tabs are paused with the Page Lifecycle freeze before they sleep, keeping their place but using no CPU; they resume instantly when shown. Tabs playing audio, pinned, using the mic or camera, in a call or downloading keep running
- Memory saver (Off / Balanced / Maximum) with a memory limit: when Vela uses more than the limit, the least recently used background tabs are slept; the performance chip shows how much it freed

### Changed
- Faster startup: the main process reuses a V8 compile cache across launches, and vela:// pages (new tab, settings, history) use Chromium's code cache
- The audio mixer, VPN panel, release notes and site-permission prompt load on first use, trimming the browser UI's startup bundle by about 8%
- Background throttling can no longer be switched off by command-line switches; intensive wake-up throttling stays enabled
- Address-bar prefetch: resting on a URL suggestion for 150 ms fetches the page into the cache through the Space's session, so cacheable pages open almost instantly (291 ms → 25 ms on a local test). https only, never search pages, Burner Spaces or VPN-routed tabs, 1 at a time and 3 per minute. Settings → Performance → "Preload pages from the address bar" (on by default)
- Per-Space timezone and language (Space dialog and Settings → Spaces): Timezone Automatic / System / UTC / Match VPN country / a fixed zone; Language System / English / others. Timezone and Intl locale use Chromium's native per-tab override (DevTools protocol), so the page, its iframes and its workers report the same zone, offset, `Date` strings and locale; navigator.language(s) and Accept-Language follow the Space language. Automatic means UTC in Strict (the VPN country's zone for routed tabs) and the system zone in Standard.
- Strict fingerprint protection reduces font enumeration: `measureText` and `document.fonts.check` answer as if fonts outside a common per-platform set (and the page's own web fonts) were not installed; `queryLocalFonts()` is denied.
- Extension permission review: adding an extension (Chrome Web Store or unpacked) first shows what it will be able to do in plain language with a risk level per line ("Read and change all your data on all websites", debugger, native messaging, proxy, history = high; tabs, cookies, webRequest = medium). Nothing is added until you confirm; a declined store download is deleted
- Settings → Extensions shows each extension's permissions, a "High access" badge for high-risk ones and a Site access control: On all sites, On specific sites (a saved host list) or On click (the extension stays unloaded until you click its toolbar button, once per launch)
- Panic button (`Ctrl+Shift+Delete` or "Panic: wipe Burners and lock" in the command palette): minimizes Vela, mutes every tab, drops all MantelVPN routes and closes and wipes every Burner Space. Nothing persistent is deleted unless Settings → Privacy → "Also clear the last 15 minutes of history" is on
- Phishing & malware protection: pages and frames are checked locally against the URLhaus (malware URLs), Phishing Army (phishing domains) and uBlock "Badware risks" lists, downloaded on start and every 6 h — nothing you visit is sent anywhere. A listed page shows a calm warning with "Back to safety" and a small "Proceed anyway (unsafe)" that allows that site until Vela quits; listed frames are blocked, and downloads from listed sites are only revealed in their folder, never opened directly. Settings → Privacy → "Warn about dangerous sites" (on by default) shows the entry count and last update
- Site info panel: click the lock/host chip in the address palette for the connection state, trackers blocked on the page, the permissions this site holds in the current Space (revoke or reset each one), its cookie count and stored data size, a "Clear site data" button, and a per-site "When Vela closes: Keep data / Delete data" choice
- Clear cookies and site data when Vela closes (Settings → Privacy, per Space) with a list of sites to keep; optionally clear a site's data 30 seconds after its last tab in that Space closes. Clearing runs during quit with a bounded timeout; burner Spaces are wiped as before
- Task manager (`Shift+Esc`, palette "Task manager", or the activity button in the perf popover): CPU and private memory per tab (favicon, Space colour, active / playing / background / asleep / crashed), per extension, the Vela interface, Browser, GPU and utility services (Network, Audio…), with sortable columns, totals and Sleep / End process / Go to tab. Live once a second while open; nothing runs while it is closed
- Settings → Privacy → "Remove tracking parameters" (on by default): click and share trackers (utm_*, fbclid, gclid, msclkid, igshid, mc_eid, HubSpot/Marketo ids, Spotify/YouTube `si`, Twitter/X `ref_src`, …) are stripped from pages you open, addresses you type and links you copy. A curated list that leaves affiliate tags such as Amazon `tag` alone; removed parameters count towards the tab's blocked badge
- Settings → Privacy → "Trim referrers" (on by default): other sites only receive the origin you came from, never the full page address, even when a page asks for more; nothing is sent when going from HTTPS to HTTP
- Release pipeline is ready for code signing: Windows via Azure Trusted Signing or a PFX certificate, macOS via Developer ID with notarization (hardened runtime + entitlements for camera, microphone, location and security keys). It switches on automatically once the secrets in docs/RELEASING.md are added; without them releases stay unsigned as before
- Secure DNS (DNS-over-HTTPS) in Settings → Privacy: Off, Automatic (upgrade when the system resolver supports it), Cloudflare, Quad9, Mullvad, Mullvad with ad blocking, NextDNS (configuration ID) or a custom `https://` template. "Strict" fails lookups instead of falling back to plain DNS. Applies live to every Space at once (Electron's resolver is process-global); Spaces behind a proxy or MantelVPN keep resolving through the proxy
- Content blocking is ready before the first page loads: new sessions wait for the cached engine (~30 ms warm; capped at 3 s on a first run without cache). The cached engine is now versioned by Ghostery version and list set, a corrupt or outdated cache is rebuilt, and a long-running browser refreshes its lists every 24 h instead of only at launch.

### Security
- Windows downloads carry the Mark-of-the-Web (`Zone.Identifier`: internet zone plus source and referrer URL, URLs omitted for burner Spaces and blob/data downloads), so SmartScreen, Defender and Office Protected View treat them like Chrome downloads
- Packaged builds flip Electron fuses: no `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` or `--inspect`; app code only from an integrity-checked `app.asar`; cookies encrypted at rest with the OS key. Existing plaintext cookies stay readable and are encrypted as they are rewritten; going back to 0.6.0 or older afterwards logs you out of sites

## [0.6.0] - 2026-11-10

### Added
- MantelVPN per tab: right-click a tab → MantelVPN → a country from the live server list routes just that tab through Mantel (Off brings it back). The country's flag shows faintly behind the tab, fading to the right, in the horizontal strip, vertical rows and split segments; the tooltip says "Via MantelVPN · <country>". A routed tab has its own cookies and logins per country (separate partition with the Space's protections), keeps its routing across restarts and fails closed if the proxy is unavailable. Not signed in: the menu offers "Sign in to MantelVPN…"
- Bundled country flags (no flag emoji on Windows), also used in the VPN server picker

### Changed
- The theme setting now applies to the whole workspace: Vela drives the system colour scheme (native menus, Mica/Acrylic backdrop, opaque window background, prefers-color-scheme), and every open vela:// page (new tab, settings, history, error) follows theme and Space-colour changes live, without a reload
- Tab views paint the themed backdrop before a vela:// page's first frame, so a dark new tab no longer flashes white
- The Vela logo in the About section takes the Space accent for its cap and glow, like the sidebar mark and the new-tab logo
- The new-tab page background carries a faint flat tint of the Space accent

### Fixed
- New tabs (the + button, the vertical New Tab row, Ctrl+T and the palette's New tab command) open Vela's start page with its search box focused instead of popping the command palette; clicking the address, Ctrl+L and Ctrl+K still open it
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

[Unreleased]: https://github.com/Aepzie/tarnel/compare/v0.8.3...HEAD
[0.8.3]: https://github.com/Aepzie/tarnel/compare/v0.8.0...v0.8.3
[0.8.0]: https://github.com/Aepzie/tarnel/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/Aepzie/tarnel/compare/v0.6.0...v0.7.1
[0.7.0]: https://github.com/Aepzie/tarnel/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Aepzie/tarnel/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Aepzie/tarnel/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Aepzie/tarnel/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Aepzie/tarnel/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Aepzie/tarnel/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Aepzie/tarnel/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Aepzie/tarnel/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/Aepzie/tarnel/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Aepzie/vela/releases/tag/v0.1.0
