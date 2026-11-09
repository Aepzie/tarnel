import type { TabAudioLevel } from '@shared/audio-mixer';
import type { MixerApi } from './mock';

/**
 * Live levels, outside React. Main pushes ~20×/s while the panel is open; meters, the spectrum and
 * the bass wave read `levelOf()` from one shared rAF loop and interpolate between pushes.
 */
const latest = new Map<number, { level: TabAudioLevel; at: number }>();
/** A level older than this counts as silence (tab stopped, levels paused). */
const STALE_MS = 400;

export function watchLevels(api: MixerApi): () => void {
  const off = api.onLevels((levels) => {
    const at = performance.now();
    for (const level of levels) latest.set(level.tabId, { level, at });
  });
  api.watchLevels(true).catch(() => undefined);
  return () => {
    off();
    api.watchLevels(false).catch(() => undefined);
    latest.clear();
  };
}

export function levelOf(tabId: number): TabAudioLevel | null {
  const entry = latest.get(tabId);
  if (!entry || performance.now() - entry.at > STALE_MS) return null;
  return entry.level;
}

/** Mean of the lowest spectrum bins (≈20–150 Hz), 0..1; falls back to the peak when there's no spectrum. */
export function bassOf(tabId: number): number {
  const level = levelOf(tabId);
  if (!level) return 0;
  if (level.spectrum.length < 4) return Math.max(level.peakL, level.peakR) * 0.6;
  return (level.spectrum[0]! + level.spectrum[1]! + level.spectrum[2]! + level.spectrum[3]!) / 4;
}

type FrameCallback = (dt: number, now: number) => void;
const frames = new Set<FrameCallback>();
let raf = 0;
let last = 0;

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frames.forEach((callback) => callback(dt, now));
  raf = frames.size > 0 ? requestAnimationFrame(loop) : 0;
}

/** Run `callback` every animation frame until the returned function is called. */
export function onFrame(callback: FrameCallback): () => void {
  frames.add(callback);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  return () => {
    frames.delete(callback);
  };
}

/** Meter floor in dB: anything quieter reads as empty. */
const FLOOR_DB = -54;

/** Linear peak (0..1) → meter position (0..1) on a dB scale. */
export function meterPosition(linear: number): number {
  if (linear <= 0) return 0;
  const db = 20 * Math.log10(linear);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}

export interface Ballistics {
  value: number;
  hold: number;
  holdAge: number;
}

const RELEASE_PER_S = 0.9;
const HOLD_S = 0.9;
const HOLD_FALL_PER_S = 0.45;

export const newBallistics = (): Ballistics => ({ value: 0, hold: 0, holdAge: 0 });

/**
 * Classic meter ballistics: instant attack, linear release in meter space, peak hold that waits
 * then falls. With `instant` (reduced motion) it shows the raw value.
 */
export function stepBallistics(state: Ballistics, target: number, dt: number, instant: boolean): void {
  if (instant) {
    state.value = target;
    state.hold = target;
    return;
  }
  state.value = target >= state.value ? target : Math.max(target, state.value - RELEASE_PER_S * dt);
  if (state.value >= state.hold) {
    state.hold = state.value;
    state.holdAge = 0;
    return;
  }
  state.holdAge += dt;
  if (state.holdAge > HOLD_S) state.hold = Math.max(state.value, state.hold - HOLD_FALL_PER_S * dt);
}

/** Accent colour of the active Space (re-read at most every 500 ms; canvas can't use CSS vars). */
let accentCache = { value: '#60a5fa', at: -Infinity, light: false };
export function themeColors(): { accent: string; light: boolean } {
  const now = performance.now();
  if (now - accentCache.at > 500) {
    const root = document.documentElement;
    accentCache = {
      value: getComputedStyle(root).getPropertyValue('--accent-space').trim() || '#60a5fa',
      at: now,
      light: root.classList.contains('light'),
    };
  }
  return { accent: accentCache.value, light: accentCache.light };
}
