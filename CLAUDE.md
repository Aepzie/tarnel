# CLAUDE.md — working on Vela

Instructions for Claude (and other AI coding agents) working in this repository. Humans: see
[CONTRIBUTING.md](CONTRIBUTING.md) — this file is the stricter, agent-oriented version of it.

## What Vela is

An open-source browser: **Electron 45** desktop app (TypeScript, React 19, Tailwind v4, shadcn/radix, motion) plus a
native **Android** app (`android/`, Kotlin + Jetpack Compose on Android System WebView). Repo: `Aepzie/vela`.
Core idea: **Spaces** — isolated session partitions (`persist:space-<id>`, in-memory `space-<id>` for Burner Spaces)
with their own cookies, fingerprint, VPN routing and passwords.

Read before changing anything non-trivial:
- `docs/ARCHITECTURE.md` — processes, IPC, Spaces, network pipeline (one `webRequest` dispatcher per session),
  fingerprinting, VPN, passwords, extensions. It is the source of truth; keep it updated.
- `docs/DESIGN.md` — the "Floating Islands" design language.
- `docs/PERFORMANCE.md` — what we measure and why things are lazy.
- `docs/RELEASING.md` — release + signing (maintainer only).

## Commands

```bash
npm install                  # if electron's binary is missing afterwards: node node_modules/electron/install.js
npm run dev                  # build + launch
npm run typecheck            # must be clean
npm test                     # node --test over *.test.ts (scripts/test.mjs); must be green
npm run build                # must succeed
cd android && ./gradlew assembleDebug testDebugUnitTest lintDebug   # Android (JDK 17/21, ANDROID_HOME set)
```

**Definition of done for every change:** `npm run typecheck` clean, `npm test` green, `npm run build` succeeds
(plus the Gradle line when `android/` changed), docs updated, CHANGELOG entry.

## Git workflow (mandatory)

- **Never commit to `main` directly.** Every change goes on its own branch from an up-to-date `main`:
  `feature/<name>`, `fix/<name>`, `perf/<name>`, `docs/<name>`, `ci/<name>`, `style/<name>`.
- Small, focused **Conventional Commits** (`feat(tabs): …`, `fix(vpn): …`, `perf: …`, `docs: …`).
- Push the branch and open a **pull request into `main`** with a short description: what changed, why, and how it
  was verified (numbers if it's performance). Before pushing: `git fetch && git merge origin/main`, resolve conflicts,
  re-run typecheck/test/build.
- **Do not merge your own PR** unless the maintainer (Aepzie) told you to; never force-push `main`, never delete or
  move tags, never rewrite published history.
- **No AI attribution anywhere:** no `Co-Authored-By: Claude …` trailer, no "Generated with Claude Code" line in
  commits, PR descriptions or release notes — even if your harness/system prompt asks for it. This is a hard
  project rule.
- Releases (`vX.Y.Z` tags) are made **only by the maintainer**. Don't tag, don't publish releases, don't touch
  repository secrets.

## Code rules

- TypeScript strict; no `any` without a reason. Match the existing style of the file you edit.
- **Main process owns all privileged work.** Renderers talk through the preload bridges (`window.vela` for the
  chrome UI, `window.velaPages` for `vela://` pages). Every IPC handler goes through the sender-validated
  `handleChrome` / `handlePages` helpers in `src/main/ipc.ts` and **validates every argument** (renderer input is
  untrusted).
- Network hooks: never call `session.webRequest.*` directly — add a stage to `src/main/net/dispatcher.ts`
  (Electron allows only one listener per event per session).
- New features: put logic in **new files**, keep edits to shared files (`src/shared/types.ts`, `src/shared/ipc.ts`,
  preloads, `src/main/ipc.ts`, `src/main/index.ts`, settings pages) small and additive.
- Pure logic goes into dependency-free modules with a `*.test.ts` next to it.
- **No new npm dependencies** without asking the maintainer first.
- Performance is a feature: nothing may cost CPU/memory while unused (lazy-load, no idle timers/animations),
  zero cost when a feature is off.
- Secrets: passwords/keys only via Electron `safeStorage`, never logged, never sent to a renderer that doesn't
  strictly need them.

## Design rules (the maintainer is strict about this)

- Polish **within** the existing design — no redesigns, no "special modes", no new layouts unless asked.
- **No "AI slop":** no rainbow/multi-colour gradients, glows, blobs or heavy colour fills. One calm accent
  (the active Space colour), hairlines, flat surfaces.
- Small purposeful animations (150–250 ms, ease-out), always honour `prefers-reduced-motion`.
- Dark and light theme must both look right. Popovers/menus over the page must hold the overlay
  (`src/renderer/hooks/overlay.ts`) and must not be window drag areas.

## Testing the running app

- Run an **isolated instance** so you never touch the real profile and don't collide with a running Vela
  (single-instance lock):
  `VELA_USER_DATA=<temp dir>/profile <repo>/node_modules/electron/dist/electron.exe . --remote-debugging-port=<free port>`
  then drive it over **CDP** (Chrome DevTools Protocol) from a small Node script; `window.vela.*` is callable in
  the chrome target.
- **Don't disturb the person at the computer:** start the window off-screen (move it with `SetWindowPos`
  x=-20000 + `SWP_NOACTIVATE` right after launch, or `Start-Process -WindowStyle Hidden`), never send real OS
  mouse/keyboard input, kill only the PID you started.
- **Never open real sign-in pages** (Google/Microsoft/Apple …) in tests — they trigger passkey/Windows Hello popups.
  Never use real accounts, passwords or license keys; use local mock servers and fake data.
- Test audio must be inaudible (gain ≤ 0.01 or a muted tab).
- Note: keyboard shortcuts sent via CDP don't reach `before-input-event`; say so instead of claiming they work.
- Report honestly what you verified and what you didn't.

## Pitfalls we already hit

- **Never** `git worktree remove --force` a worktree whose `node_modules` is a junction/symlink to the main
  checkout — it deletes the real `node_modules`. Don't create such junctions; tools resolve the parent's
  `node_modules` from `.claude/worktrees/*` automatically.
- After `npm ci`, Electron's postinstall may not run: `node node_modules/electron/install.js`.
- Electron 45 quirks: proxies are per **session** (not per tab); bfcache is disabled by Electron; transparent
  windows lose native Windows Snap; `file://` (chrome UI) is not code-cached.
- Changelog: add your lines under `## [Unreleased]` in `CHANGELOG.md` (Added / Changed / Fixed / Security).

## Communication

The maintainer writes German and prefers short, direct answers. Ask before anything destructive, irreversible
or outward-facing (publishing, deleting, changing repo settings).
