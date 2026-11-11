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
│  │ ◀ ▶ ⟳ │ [● Space ▾] │  tab  tab  [▣ Active tab ✕]  tab  tab  +  │ ⚡ 412MB │ – ▢ ✕ │
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
* **Tabs as pills**: favicon + short title. All unpinned tabs share one width (max 200px), shrinking evenly as tabs
  are added; below ~56px they collapse to favicon only (36px). Pinned tabs are always favicon only. Activation never
  changes a width. The active tab gets a raised fill and an always-visible close button (others show it on hover;
  middle-click closes any tab). Clicking the active tab morphs its fill (shared `layoutId`) into the command palette,
  which shows the page's security state, host and blocked-request count next to the address.
* **Focus mode** (`settings.autoHideToolbar`, toggle Ctrl+Shift+S): island slides up & fades out, page island
  takes full height (8px margins). Hovering the top 6px edge slides the island back in as an overlay.
* `#viewport` is a transparent placeholder measured with ResizeObserver → `vela.ui.setContentBounds`.
* The vertical tab island aligns with the top island, with 8px window insets on all three outer edges. Tab lists
  keep 8px inner padding and scroll padding so the first tab's outline remains visible. Pinned tiles fit
  the available inner width, including the 36px content area of the collapsed 52px rail.

## Visual tokens

* Base: window background `#09090b` (or transparent over Mica/Acrylic). Islands: `bg-zinc-900/70` + `backdrop-blur-2xl`
  + `ring-1 ring-white/[0.08]` + inner top highlight `shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]`.
* Text: zinc-100 primary, zinc-400 secondary, zinc-500 tertiary. 12–13px UI text, `tracking-tight` on titles.
* **Accent = active Space color** (CSS var `--accent-space`, set on `<html>`): used sparingly — active-tab glow
  (`0 0 0 1px accent/35%, 0 8px 24px -8px accent/40%`), loading bar, focus rings, switch fill, selection.
* Space colors: slate #94a3b8, blue #60a5fa, violet #a78bfa, pink #f472b6, red #f87171, orange #fb923c,
  green #4ade80, teal #2dd4bf.
* Radii: islands 16px, page 12px, pills 10px, menu items 8px, chips full.
  Buttons use the shared radius tokens: regular/large 12px (`rounded-lg`), compact and toolbar controls
  10px (`rounded-md`), extra-small 8px (`rounded-sm`).
* Segmented controls: 12px outer radius with 4px padding/gaps, 8px item radius. The animated selection
  inherits its item's radius, keeping concentric corners in every theme. In Glass, the track carries
  the material and the active indicator carries the reflection; inactive items stay clear.
* The non-scrolling new-tab page does not reserve a scrollbar gutter, so its background fills the
  entire page view. Scrollable internal pages keep their stable scrollbar space.
* The new-tab clock keeps tight tracking on hours/minutes. Half-size seconds use normal tracking so
  they do not inherit the main time's larger negative spacing and get clipped by their digit masks.
* Light theme supported via `.light` class / `data-theme="light"` (islands `bg-white/70`, ring black/8).
* NO: gradients on surfaces (except accent glows & subtle noise), generic drop shadows on everything,
  blue default buttons, emoji icons. Use lucide icons, size 15–16, strokeWidth 1.75.

## Glass preview

Appearance → **Glass theme (Preview)** is an opt-in prototype (`settings.glassTheme`, default false),
independent of System/Dark/Light. The scoped stylesheet `styles/glass-preview.css` uses translucent
neutral fills, static edge reflections, brighter rims and restrained shadows on existing surfaces.
This preview permits subtle reflection gradients on surfaces; the standard theme keeps its flat fills.
Chrome islands rely on the native Mica/Acrylic backdrop, since CSS cannot blur another WebContentsView.
Menus and the new-tab search field can blur content in their own document. No idle animation, new
dependencies or layout changes. Reduced transparency uses solid surfaces; battery saver disables blur
in the chrome. Switch the preview off to restore the standard styling immediately.
`styles/glass-controls.css` extends that material to action and toolbar buttons, tabs, segmented
controls, switches, standalone form fields, sliders, tooltips and site tiles. Primary actions retain
an accent tint; focus outlines, validation errors and disabled states remain explicit. Invisible hero
hit areas, style dots, semantic color swatches and macOS traffic lights keep their original roles.
Controls use static reflections rather than an additional blur layer per button.

## Motion (import from `@/lib/motion`)

* `spring.snappy`  = { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 } — layout, tab reorder, indicators
* `spring.soft`    = { type: 'spring', stiffness: 300, damping: 30 } — islands sliding, palette
* `ease.out`       = [0.22, 1, 0.36, 1], durations 0.14–0.24s for fades.
* Tab open: width 0→auto + opacity + scale 0.92→1. Tab close: collapse width + fade (AnimatePresence, `mode="popLayout"`).
* Active tab indicator / hover highlight: shared `layoutId` pill that glides between tabs.
* Palette: from active tab via `layoutId="omnibox"`; content fades in with blur(6px)→0, y -6→0; backdrop fade.
* Menus/popovers: scale 0.96→1, opacity, origin-aware (Radix `--radix-*-transform-origin`).
* Loading: accent spinner ring around the tab's favicon (vertical omnibox: 2px shimmering bar).
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
