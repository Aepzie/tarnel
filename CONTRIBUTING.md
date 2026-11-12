# Contributing to Tarnel

Thanks for your interest in Tarnel. This document explains how to set up a development environment,
how the code is organized, and what we look for in a pull request.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues go through
[SECURITY.md](SECURITY.md), never public issues.

## Prerequisites

- **Node.js 20+** (22 LTS recommended) and npm
- Git
- Platform build tools are only needed for packaging installers (see [electron-builder docs](https://www.electron.build/))

## Getting started

```bash
git clone https://github.com/Aepzie/tarnel.git
cd tarnel
npm install
npm run dev        # build once and launch Tarnel
```

| Script              | What it does                                                    |
|---------------------|-----------------------------------------------------------------|
| `npm run dev`       | Build everything and start Electron                             |
| `npm run watch`     | Rebuild on file changes (run `npm start` in a second terminal)  |
| `npm start`         | Launch the last build                                           |
| `npm run typecheck` | Type-check the whole project with `tsc --noEmit`                |
| `npm run build`     | Development build into `dist/`                                  |
| `npm run dist`      | Production build + installers for the current OS into `release/`|
| `npm run dist:dir`  | Production build + unpacked app (fast, for smoke testing)       |

To try a build without touching your everyday profile, point it at a throwaway data folder:
`TARNEL_USER_DATA=/tmp/tarnel-test npm start` (`VELA_USER_DATA` is still honoured as a fallback).

Tarnel was called Vela until 0.9.x. Some internal identifiers keep the old name on purpose so existing
installs update cleanly (the `appId`, Android package `org.velabrowser.vela`, `window.vela` /
`window.velaPages`, IPC channels, storage keys, `VELA_*` dev switches). Use "Tarnel" and `tarnel://`
in anything a user sees.

## Project layout

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. In short:

```
src/main/        main process: window, tabs, spaces, IPC, protocol, privacy, perf/*
src/preload/     contextBridge APIs (window.vela, window.velaPages) — sandboxed, electron import only
src/renderer/    chrome UI (top island, palette, find bar) and tarnel:// pages — React/Vite
src/shared/      types and IPC contracts shared by all processes
scripts/         build and tooling scripts
build/           icons and packaging resources
```

## Guidelines

- **Keep it lean.** The UI is React + Tailwind + shadcn/ui — reuse existing components and the motion
  presets in `src/renderer/lib/motion.ts`. New dependencies need a justification in the PR (size,
  maintenance, security). Follow [docs/DESIGN.md](docs/DESIGN.md).
- **Measure performance claims.** If a change is meant to be faster or lighter, include before/after numbers
  and how you measured them (see [docs/PERFORMANCE.md](docs/PERFORMANCE.md)).
- **Never weaken isolation.** Web content runs with `sandbox: true`, `contextIsolation: true` and
  `nodeIntegration: false`. Every IPC handler must validate its sender. Nothing may share state across
  Space partitions.
- **Respect contracts.** Signatures in `src/shared/` and the module contracts in ARCHITECTURE.md are
  shared between areas; change them deliberately and update the docs in the same PR.
- **TypeScript strict.** `npm run typecheck` must pass with no errors.
- **Style.** 2-space indentation, LF line endings (enforced by `.editorconfig` / `.gitattributes`).

## Regenerating icons

The Tarnel mark (a mountain over a still lake, its reflection drawn as three accent bands) is defined
once, in [`src/shared/brand-mark.ts`](src/shared/brand-mark.ts): the glyph's path data plus the
app-icon tile. The settings page, the new-tab logo hero and the internal-page
favicons import it directly; every build asset is generated from it with Electron's offscreen
renderer, so no extra dependencies are required:

```bash
npm run icons
```

This writes `build/icon.svg` (full-colour master), `build/icon-mono.svg` (single-colour glyph),
`build/icon.png` (1024×1024), `build/icons/{16…1024}.png` (Linux), `build/icon.ico` (Windows, 16–256)
and `build/icon.icns` (macOS squircle with Apple's margin). Output is deterministic. Never edit these
files by hand; commit them together with any change to `brand-mark.ts`, since CI and release builds
use the committed files.

## Commits and pull requests

1. Fork the repository and create a branch from `main` (`fix/find-bar-focus`, `feat/split-view`).
2. Keep pull requests focused — one logical change each.
3. Use clear commit messages; [Conventional Commits](https://www.conventionalcommits.org/) style
   (`feat:`, `fix:`, `perf:`, `docs:`) is appreciated.
4. Add an entry under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for user-facing changes.
5. Make sure CI is green (typecheck + build on Windows, macOS and Linux).
6. Attach screenshots or short recordings for UI changes.

## Releases

Maintainers tag a version (`git tag v0.2.0 && git push --tags`). The
[release workflow](.github/workflows/release.yml) builds installers for all platforms and publishes them
to GitHub Releases.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
