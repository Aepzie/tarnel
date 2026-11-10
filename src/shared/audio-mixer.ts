/**
 * Audio mixer contract shared by main (DSP routing into tabs), the page engine (Web Audio graph inside each
 * tab) and the chrome UI (mixer panel). Desktop only.
 */

/** Centre frequencies (Hz) of the graphic equalizer, low to high. */
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

/** Per-band gain range in dB. */
export const EQ_GAIN_RANGE = { min: -12, max: 12 } as const;

/** Linear tab volume range: 0 = silent, 1 = unchanged, 2 = +6 dB boost. */
export const VOLUME_RANGE = { min: 0, max: 2 } as const;

export interface BassBoost {
  /** Extra low-shelf gain in dB, 0 = off. */
  gain: number;
  /** Shelf corner frequency in Hz (40–250). */
  frequency: number;
}

export interface TabAudioSettings {
  /** Linear gain, see VOLUME_RANGE. */
  volume: number;
  /** Stereo balance: -1 = left only, 0 = centre, 1 = right only. */
  balance: number;
  /** Fold the tab to mono (one earbud, odd mixes). */
  mono: boolean;
  eqEnabled: boolean;
  /** Gain in dB per EQ_FREQUENCIES entry (same length and order). */
  bands: number[];
  bassBoost: BassBoost;
  /** Gentle dynamics compressor: evens out loud ads/quiet dialogue. */
  compressor: boolean;
  /** Name of the preset the bands came from; null once the user edits a band. */
  preset: EqPresetId | null;
}

export type EqPresetId = 'flat' | 'bass' | 'vocal' | 'treble' | 'loudness' | 'podcast' | 'night';

export const EQ_PRESETS: Record<EqPresetId, { label: string; bands: number[]; bassBoost?: Partial<BassBoost> }> = {
  flat: { label: 'Flat', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'Bass', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], bassBoost: { gain: 4, frequency: 90 } },
  vocal: { label: 'Vocal', bands: [-2, -2, -1, 0, 2, 4, 4, 2, 0, -1] },
  treble: { label: 'Treble', bands: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  loudness: { label: 'Loudness', bands: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5] },
  podcast: { label: 'Podcast', bands: [-4, -3, -1, 1, 3, 4, 3, 1, -1, -3] },
  night: { label: 'Night', bands: [-3, -2, -1, 0, 1, 2, 1, 0, -2, -4] },
};

export const DEFAULT_TAB_AUDIO: TabAudioSettings = {
  volume: 1,
  balance: 0,
  mono: false,
  eqEnabled: false,
  bands: [...EQ_PRESETS.flat.bands],
  bassBoost: { gain: 0, frequency: 90 },
  compressor: false,
  preset: 'flat',
};

/** True when the settings leave the signal untouched, so the page needs no processing graph at all. */
export function isNeutralAudio(settings: TabAudioSettings): boolean {
  return (
    settings.volume === 1 &&
    settings.balance === 0 &&
    !settings.mono &&
    (!settings.eqEnabled || settings.bands.every((gain) => gain === 0)) &&
    settings.bassBoost.gain === 0 &&
    !settings.compressor
  );
}

/** Live level of one tab, sent while the mixer panel is open. Values are 0..1 (linear, post-processing). */
export interface TabAudioLevel {
  tabId: number;
  peakL: number;
  peakR: number;
  /** Coarse spectrum for the visualizer: 16 bins, log-spaced 20 Hz–20 kHz, 0..1. Empty when unavailable. */
  spectrum: number[];
}

/** How a tab's audio can be processed. */
export type MixerRouting =
  /** Everything audible is routed through the processing graph. */
  | 'full'
  /** Some media is cross-origin without CORS; only volume/mute apply to it (Web Audio would output silence). */
  | 'partial'
  /** Nothing is being processed: no engine, neutral settings, or nothing routed is playing. */
  | 'idle'
  /**
   * The tab is audible with non-neutral settings, but its sound started before the engine was attached
   * where the engine cannot reach it live (a page AudioContext connected earlier, a detached `new Audio()`
   * nobody touches): it applies after a reload.
   */
  | 'reload';

export interface MixerTabState {
  tabId: number;
  settings: TabAudioSettings;
  routing: MixerRouting;
}

/** Chrome ↔ main channels. */
export const MIXER_IPC = {
  get: 'chrome:mixer-get',
  set: 'chrome:mixer-set',
  reset: 'chrome:mixer-reset',
  watchLevels: 'chrome:mixer-watch-levels',
  /** main → chrome push: MixerTabState[] whenever settings or routing change. */
  stateEvent: 'chrome-event:mixer-state',
  /** main → chrome push: TabAudioLevel[] ~20×/s while watching. */
  levelsEvent: 'chrome-event:mixer-levels',
} as const;
