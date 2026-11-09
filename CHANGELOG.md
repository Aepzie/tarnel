# Changelog

All notable changes to Vela are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Aepzie/vela/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Aepzie/vela/releases/tag/v0.1.0
