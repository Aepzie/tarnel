import { app, screen, type Display, type Rectangle } from 'electron';
import type { DisplayRefresh, FrameRateMode, FrameRateStatus } from '../../shared/types';
import { getSettings } from '../settings';
import { createStore, type JsonStore } from '../store';
import { getMainWindow, savedWindowBounds } from '../window';

/**
 * Frame pacing on Windows with displays of different refresh rates.
 *
 * Stock Chromium on Windows paces every window to the PRIMARY display's vblank. With a 144 Hz laptop
 * panel next to a 75 Hz primary monitor, Tarnel renders at 75 fps even on the 144 Hz panel (measured, see
 * docs/PERFORMANCE.md). `UseCompositorClockVSyncInterval` makes Chromium pace to the DWM compositor clock
 * instead, which ticks at the FASTEST connected display's rate — right for a window on that display,
 * wasted frames (and uneven pacing) on a slower one. So the switch is only set when the window opens on a
 * display faster than the primary one ('match'), or always ('highest').
 *
 * Feature switches are fixed at launch, and Electron's `screen` is unavailable before 'ready', so the
 * decision uses the display layout saved during the previous run (userData/displays.json) and the saved
 * window bounds. When the setting, the layout or the window's display no longer match what this run started
 * with, Settings → Performance offers a restart.
 *
 * Not offered, because they don't work cleanly (measured on Electron 45 / Chromium 156, Windows 11):
 * - fixed caps (60/120/144 Hz): Chromium has no switch that caps on-screen frame production
 *   (`--limit-fps` is ignored; `--max-gum-fps` only limits getUserMedia capture);
 * - "unlimited" (`--disable-frame-rate-limit`, with or without `--disable-gpu-vsync`): rAF dropped to
 *   ~59 fps instead of rising — DirectComposition presentation throttles the uncapped frames.
 */

export const COMPOSITOR_CLOCK_FEATURE = 'UseCompositorClockVSyncInterval';

interface DisplaySnapshot {
  bounds: Rectangle;
  hz: number;
  primary: boolean;
}

interface DisplayFile {
  displays: DisplaySnapshot[];
}

let store: JsonStore<DisplayFile> | null = null;

function getStore(): JsonStore<DisplayFile> {
  store ??= createStore<DisplayFile>('displays', { displays: [] });
  return store;
}

function overlap(a: Rectangle, b: Rectangle): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The display holding most of `bounds`; the primary one when `bounds` is unknown or off-screen. */
function displayFor<T extends DisplaySnapshot>(displays: readonly T[], bounds: Rectangle | null): T | undefined {
  const primary = displays.find((d) => d.primary) ?? displays[0];
  if (!bounds) return primary;
  let best = primary;
  let bestArea = 0;
  for (const display of displays) {
    const area = overlap(display.bounds, bounds);
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }
  return best;
}

/** Whether the compositor-clock switch gives the window a higher rate than stock Chromium would. */
export function wantsCompositorClock(
  mode: FrameRateMode,
  displays: readonly DisplaySnapshot[],
  windowBounds: Rectangle | null,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32' || mode === 'primary' || displays.length < 2) return false;
  const primary = displays.find((d) => d.primary) ?? displays[0];
  if (!primary) return false;
  const target = mode === 'highest' ? Math.max(...displays.map((d) => d.hz)) : (displayFor(displays, windowBounds)?.hz ?? primary.hz);
  return target > primary.hz;
}

/** Features to enable for this launch. Runs before app 'ready' (flags.ts). */
export function frameRateFeatures(): string[] {
  const wanted = wantsCompositorClock(getSettings().frameRate, getStore().get().displays, savedWindowBounds());
  return wanted ? [COMPOSITOR_CLOCK_FEATURE] : [];
}

/** Whether this run actually started with the switch (Tarnel's flags, or the user's own command line). */
function compositorClockActive(): boolean {
  if (!app.commandLine.hasSwitch('enable-features')) return false;
  return app.commandLine.getSwitchValue('enable-features').split(',').includes(COMPOSITOR_CLOCK_FEATURE);
}

type LiveDisplay = DisplaySnapshot & { id: number; label: string };

function liveDisplays(): LiveDisplay[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d: Display) => ({
    id: d.id,
    label: d.label,
    bounds: d.bounds,
    hz: Math.round(d.displayFrequency),
    primary: d.id === primaryId,
  }));
}

function saveSnapshot(): void {
  getStore().set({ displays: liveDisplays().map(({ bounds, hz, primary }) => ({ bounds, hz, primary })) });
}

/** Remember the display layout for the next launch's decision. Call after app 'ready'. */
export function initFrameRate(): void {
  saveSnapshot();
  screen.on('display-added', saveSnapshot);
  screen.on('display-removed', saveSnapshot);
  screen.on('display-metrics-changed', saveSnapshot);
}

export function getFrameRateStatus(): FrameRateStatus {
  const displays = liveDisplays();
  const win = getMainWindow();
  const bounds = win ? win.getBounds() : savedWindowBounds();
  const current = displayFor(displays, bounds);
  const primary = displays.find((d) => d.primary);
  const supported = process.platform === 'win32';
  const active = compositorClockActive();
  const fastest = displays.reduce((max, d) => Math.max(max, d.hz), 0);
  const pacedHz = supported ? (active ? fastest : (primary?.hz ?? null)) : (current?.hz ?? null);
  return {
    supported,
    displays: displays.map((d, index): DisplayRefresh => ({
      id: d.id,
      label: d.label || `Display ${index + 1}`,
      hz: d.hz,
      primary: d.primary,
      current: d === current,
    })),
    pacedHz: pacedHz || null,
    restartRequired: supported && process.env.VELA_NO_FLAGS !== '1' && wantsCompositorClock(getSettings().frameRate, displays, bounds) !== active,
  };
}

export function relaunchApp(): void {
  app.relaunch();
  app.quit();
}
