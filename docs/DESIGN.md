# Vela — Design System ("Floating Islands")

Vela's chrome is not a frame around the web — it is a set of **floating glass islands** hovering over
the desktop. The page itself is just another island. Quiet, precise, fast, alive.

## Stack

React 19 · Tailwind CSS v4 · shadcn/ui (Radix primitives, new-york style) · `motion` (motion/react) ·
lucide-react · cmdk (via shadcn Command) · sonner (toasts). Font: **Geist Variable** (bundled locally
via `@fontsource-variable/geist`, mono: `@fontsource-variable/geist-mono`). No CDNs, no remote assets.

Renderer source lives in `src/renderer/` and is built by Vite (multi-page). Path alias `@/` → `src/renderer/`.

```
src/renderer/
  styles/globals.css          Tailwind v4 + shadcn theme tokens + Vela tokens (single source of truth)
  lib/utils.ts                cn()
  lib/motion.ts               shared springs/variants (import these, don't invent new curves)
  lib/vela.ts                 typed access to window.vela / window.velaPages + helpers
  hooks/                      useBrowserState, useSettings, useOverlay, usePerf, useActiveSpace …
  components/ui/              shadcn generated components (do not hand-edit except theming)
  chrome/                     browser chrome app (index.html, main.tsx, App.tsx, island/, palette/, spaces/, …)
  pages/newtab|settings|error each: index.html, main.tsx, App.tsx
```

## Layout (chrome window)

```
┌ window (Win11: Mica/Acrylic backdrop shows through — desktop is visible, blurred) ─────────────┐
│  8px                                                                                           │
│  ╭─ Top Island (h-11, rounded-2xl, glass) ─────────────────────────────────────────────────╮   │
│  │ ◀ ▶ ⟳ │ [● Space ▾] │  tab  tab  [ ACTIVE TAB = omnibox: 🔒 github.com/vela… ]  tab  + │ ⚡ 412MB │ – ▢ ✕ │
│  ╰──────────────────────────────────────────────────────────────────────────────────────────╯   │
│  8px                                                                                           │
│  ╭─ Page Island (WebContentsView, radius 12) ──────────────────────────────────────────────╮   │
│  │                                                                                          │   │
│  │                                   web page                                               │   │
│  ╰──────────────────────────────────────────────────────────────────────────────────────────╯   │
│  8px                                                                                           │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

* The island bar is a drag region (`-webkit-app-region: drag`); every interactive child is `no-drag`.
* **Tabs as pills**: inactive tab = favicon + short title (max ~160px, min ~36px when crowded = favicon only).
  The **active tab is the omnibox**: wider (min 280px, grows), shows lock/space dot + host in bold + path muted.
  Clicking it morphs (shared `layoutId`) into the command palette.
* **Focus mode** (`settings.autoHideToolbar`, toggle Ctrl+Shift+S): island slides up & fades out, page island
  takes full height (8px margins). Hovering the top 6px edge slides the island back in as an overlay.
* `#viewport` is a transparent placeholder measured with ResizeObserver → `vela.ui.setContentBounds`.

## Visual tokens

* Base: window background `#09090b` (or transparent over Mica/Acrylic). Islands: `bg-zinc-900/70` + `backdrop-blur-2xl`
  + `ring-1 ring-white/[0.08]` + inner top highlight `shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]`.
* Text: zinc-100 primary, zinc-400 secondary, zinc-500 tertiary. 12–13px UI text, `tracking-tight` on titles.
* **Accent = active Space color** (CSS var `--accent-space`, set on `<html>`): used sparingly — active-tab glow
  (`0 0 0 1px accent/35%, 0 8px 24px -8px accent/40%`), loading bar, focus rings, switch fill, selection.
* Space colors: slate #94a3b8, blue #60a5fa, violet #a78bfa, pink #f472b6, red #f87171, orange #fb923c,
  green #4ade80, teal #2dd4bf.
* Radii: islands 16px, page 12px, pills 10px, menu items 8px, chips full.
* Light theme supported via `.light` class / `data-theme="light"` (islands `bg-white/70`, ring black/8).
* NO: gradients on surfaces (except accent glows & subtle noise), generic drop shadows on everything,
  blue default buttons, emoji icons. Use lucide icons, size 15–16, strokeWidth 1.75.

## Motion (import from `@/lib/motion`)

* `spring.snappy`  = { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 } — layout, tab reorder, indicators
* `spring.soft`    = { type: 'spring', stiffness: 300, damping: 30 } — islands sliding, palette
* `ease.out`       = [0.22, 1, 0.36, 1], durations 0.14–0.24s for fades.
* Tab open: width 0→auto + opacity + scale 0.92→1. Tab close: collapse width + fade (AnimatePresence, `mode="popLayout"`).
* Active tab indicator / hover highlight: shared `layoutId` pill that glides between tabs.
* Palette: from active tab via `layoutId="omnibox"`; content fades in with blur(6px)→0, y -6→0; backdrop fade.
* Menus/popovers: scale 0.96→1, opacity, origin-aware (Radix `--radix-*-transform-origin`).
* Loading: 2px accent bar under active tab with shimmering indeterminate gradient.
* Space switch: accent color crossfades (CSS transition on `--accent-space` via @property), tab list slides x ±12px.
* Micro: buttons `active:scale-[0.96]`, hover bg fade 120ms. Everything honors `prefers-reduced-motion` (`useReducedMotion`).

## Overlay rule (critical)

The page `WebContentsView` sits **above** the chrome UI. Anything that can visually overlap the page area
(palette, dropdowns, context menus, popovers, tooltips that extend down, toasts) must hold an overlay
while open: `useOverlay(open)` (ref-counted → `vela.ui.setOverlay`). Radix portals render inside the
chrome document, which is then raised above the page by main.

## Performance rules

* One IPC state subscription (`useBrowserState`, `useSyncExternalStore`). Components select slices; memoize tab pills.
* No layout thrash in animations: animate transform/opacity; width animations only on tab pills via `layout`.
* Lazy-load the settings page bits; chrome bundle target < 250 KB gz.
