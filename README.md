<div align="center">

<img src="build/icon.svg" width="96" height="96" alt="Vela logo">

# Vela

**Fast. Quiet. Isolated.**

A minimal Chromium browser where every Space is its own sealed session.<br>
Work, personal, clients, throwaway: one window, no leaks between them.

[![Release](https://img.shields.io/github/v/release/Aepzie/vela?include_prereleases&style=flat-square&label=release)](https://github.com/Aepzie/vela/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/Aepzie/vela/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/Aepzie/vela/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Aepzie/vela?style=flat-square)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-Windows%20·%20macOS%20·%20Linux%20·%20Android-555?style=flat-square)

**[Download](#download)** · [Features](docs/FEATURES.md) · [Shortcuts](#shortcuts) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md)

</div>

<br>

<p align="center">
  <a href="docs/media/vela-demo.mp4">
    <img src="docs/media/vela-demo.gif" width="100%" alt="Vela demo: command palette, two Spaces signed in as different users on the same site, a Burner space with no cookies, and split view">
  </a>
  <br>
  <sub>The real app, recorded on Linux. Two Spaces, same site, two different logins. <a href="docs/media/vela-demo.mp4">Watch in full quality (MP4)</a></sub>
</p>

## Why Vela

Most browsers get heavier with every release. Vela goes the other way: a small toolbar that stays out of the way,
ads and trackers blocked before they load, idle tabs put to sleep, and **Spaces** that keep your identities apart.

**No account. No telemetry. No sync servers.** Just the web.

## Highlights

**Spaces, actually isolated.** Each Space has its own cookies, storage, cache, logins, permissions, passwords and
proxy. Sign in to two accounts on the same site, side by side. Each Space also shows sites its own stable
fingerprint, so identities can't be linked across Spaces.

**Burner spaces.** `Ctrl+Shift+N` opens a Space that lives only in memory. Close it and it's gone, cookies, history
and all.

**Privacy without add-ons.** Built-in ad and tracker blocking (Ghostery engine), cookie banners rejected for you,
local phishing protection, HTTPS-only, Secure DNS, a weekly privacy report and page translation. Blocking, phishing
checks and translation all run on your device.

**Built for flow.** Command palette (`Ctrl+K`), split view up to 2×2, Peek previews, web panels, tab groups,
vertical tabs, a screenshot editor and a per-tab audio mixer. Chrome extensions work too, including uBlock Origin Lite.

**Light on your machine.** Same engine as Chrome, so no faster-engine claims: Vela just does less. Sleeping tabs
free their renderer, sessions restore lazily, old tabs move to an archive, and a battery saver kicks in on battery.

→ **[See every feature](docs/FEATURES.md)**

## Download

**[Latest release](https://github.com/Aepzie/vela/releases/latest)**

| Platform | Files |
|----------|-------|
| Windows  | `setup-x64.exe` (installer, auto-updates) · `portable-x64.exe` (no install) |
| macOS    | `.dmg` for Apple Silicon and Intel |
| Linux    | `.AppImage` (auto-updates) · `.deb` |
| Android  | `.apk` (Android 10+) |

Builds are not code-signed yet, and every release lists SHA-256 checksums in `SHA256SUMS.txt`.
- **Windows:** SmartScreen may warn on first launch. Click **More info → Run anyway**.
- **macOS:** right-click the app → **Open**.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/spaces.png" alt="Space switcher with Personal, Work and Burner"><br><sub><b>Spaces</b>: switch between isolated sessions, or open a Burner.</sub></td>
    <td width="50%"><img src="docs/screenshots/palette.png" alt="Command palette with the query git"><br><sub><b>Command palette</b>: tabs, history, commands and search in one box.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/browsing.png" alt="Browsing GitHub in Vela"><br><sub><b>Floating island toolbar</b>: tabs, address and tracker badge in one row.</sub></td>
    <td width="50%"><img src="docs/screenshots/light.png" alt="New tab page in light theme"><br><sub><b>Light and dark</b>, or follow the system.</sub></td>
  </tr>
</table>

## Shortcuts

| | | | |
|---|---|---|---|
| `Ctrl+K` | Command palette | `Ctrl+Shift+N` | New Burner space |
| `Ctrl+T` | New tab | `Ctrl+Shift+D` | Split view on / off |
| `Ctrl+Shift+T` | Reopen closed tab | `Ctrl+Shift+X` | Screenshot |
| `Ctrl+Shift+,` | Vertical tabs | `Ctrl+Shift+Delete` | Panic: hide, mute, wipe Burners |

On macOS use `Cmd`. [All shortcuts](docs/FEATURES.md#keyboard-shortcuts)

## Build from source

Requires Node.js 20 or newer.

```bash
git clone https://github.com/Aepzie/vela.git && cd vela
npm install
npm run dev      # build and launch
npm run dist     # installers for your OS, into release/
```

The Android app lives in [`android/`](android/README.md) (Kotlin + Jetpack Compose).

## Security

Every tab is sandboxed with context isolation and site isolation. Pages never get Node.js access, and Spaces never
share session state. Details: [security model](docs/FEATURES.md#security-model) and
[hardening](docs/ARCHITECTURE.md#security-hardening). Found a vulnerability? Please follow [SECURITY.md](SECURITY.md).

## Contributing

Bug reports, fixes, docs and ideas are all welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md), or open an [issue](https://github.com/Aepzie/vela/issues).

## License

[MIT](LICENSE) © 2026 Vela contributors. Built on [Electron](https://www.electronjs.org/) and
[Chromium](https://www.chromium.org/). Ad blocking uses [@ghostery/adblocker](https://github.com/ghostery/adblocker)
(MPL-2.0).
