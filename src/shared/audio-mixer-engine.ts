import type { MixerRouting, TabAudioSettings } from './audio-mixer';

/**
 * Engine-side plumbing of the audio mixer (main ↔ page engine); the chrome-facing contract is
 * audio-mixer.ts.
 */

/** Synchronous IPC asked by the mixer preload in every frame of a Space with a processed tab. */
export const MIXER_ENGINE_CHANNEL = 'vela:mixer-engine';

/** What one realm (frame) reports to main. Levels are only included when asked for. */
export interface RealmAudioReport {
  routing: MixerRouting;
  peakL?: number;
  peakR?: number;
  /** 16 log-spaced bins, 0..1 (see TabAudioLevel.spectrum). */
  spectrum?: number[];
}

/** Installed on the page's main world under `Symbol.for('vela.mixer')`. `null` settings = neutral (bypass). */
export interface MixerEngineHandle {
  update(settings: TabAudioSettings | null): void;
  report(levels: boolean): RealmAudioReport;
  /** Re-reads the processing context's `destination`, so a live audio-devices route steers it too. */
  touch(): void;
}
