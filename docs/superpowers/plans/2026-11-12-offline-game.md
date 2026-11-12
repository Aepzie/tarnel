# Offline Minigame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer a fully local optional minigame on desktop offline error pages.

**Architecture:** Pure eligibility and simulation, with a lazy React/SVG component in the existing error page. No new protocol, dependencies or storage.

**Tech Stack:** Existing TypeScript, React 19, Tailwind tokens and Electron.

**Spec:** `docs/superpowers/specs/2026-11-12-offline-game-design.md`

## Global Constraints

- English copy/docs; Tarnel branding. No new dependencies, network resources, IPC, telemetry or persistence.
- No animation before explicit play or while hidden, paused or unmounted.
- Preserve security warnings, retry/back, browser shortcuts and Space isolation.
- Support both themes, narrow windows, keyboard/pointer and reduced motion.

## Review Focus

- OS reports online with an internet-disconnected error: still offer the game.
- Certificate/security error while offline: never show the game.
- Long frame or background resume: no fast-forward or automatic restart.
- Focus on retry/back: game keys must not capture those buttons.
- Narrow/short window or reduced motion: accessible controls, no decorative movement.

### Task 1: Pure simulation and eligibility

**Files:** create `src/renderer/pages/error/game/{engine.ts,engine.test.ts,eligibility.ts,eligibility.test.ts}`.

**Interfaces:** `createRun(): RunState`, `act(run, action): RunState` for start/jump/pause/resume, `advance(run, milliseconds, random): RunState`, `canPlayOffline(code, online): boolean`. State includes mode, height, velocity, distance, score, spawn timer and obstacles; scene constants are exported.

- [ ] Test explicit start, jump/landing/no double jump, collisions, score, pause/restart, bounded long frames and invalid timing. Test offline eligibility including security failures.
- [ ] Run tests to observe missing behavior; implement deterministic simulation and allowlist.
- [ ] Run `npm test`, expect success, commit behavior and tests.

### Task 2: Local UI integration and verification

**Files:** create `src/renderer/pages/error/game/OfflineGame.tsx`; modify `src/renderer/pages/error/App.tsx`, `docs/{ARCHITECTURE,FEATURES,PERFORMANCE}.md`, `CHANGELOG.md`.

**Interfaces:** consumes Task 1. `OfflineGame({onClose})` owns active frames/listeners without IPC or storage; App owns eligibility/lazy mounting.

- [ ] Prepare an isolated real-app smoke test for the offline game entry; observe failure before adding UI.
- [ ] Implement responsive SVG, controls, focused keyboard handling, state announcements, hidden/blur pause and cleanup.
- [ ] Exercise offline navigation, pause/resume, collision/restart, retry, no remote resources, themes and narrow layout; capture screenshots.
- [ ] Update existing docs/changelog. Run typecheck, full tests, build and diff checks; expect success.
- [ ] Obtain a separate review, resolve confirmed defects and prepare the feature for the repository PR workflow, separate from DRM.
