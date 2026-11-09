import {
  DEFAULT_TAB_AUDIO,
  EQ_FREQUENCIES,
  EQ_GAIN_RANGE,
  EQ_PRESETS,
  VOLUME_RANGE,
  type BassBoost,
  type EqPresetId,
  type TabAudioSettings,
} from '../../shared/audio-mixer';

/**
 * Per-tab mixer settings. Pure state (no Electron, no tabs.ts import) so tabs.ts can read it for the
 * session file without an import cycle; index.ts does the wiring. Only non-default settings are kept.
 */
const store = new Map<number, TabAudioSettings>();
const listeners = new Set<(tabId: number) => void>();

const BASS_GAIN = { min: 0, max: EQ_GAIN_RANGE.max } as const;
const BASS_FREQUENCY = { min: 40, max: 250 } as const;

function emit(tabId: number): void {
  for (const listener of listeners) {
    try {
      listener(tabId);
    } catch {
      /* ignore listener errors */
    }
  }
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/** Finite number, clamped and rounded (0.01 dB / 0.001 linear is far below audibility). */
function num(value: unknown, range: { min: number; max: number }, step: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${name}`);
  const scale = Math.round(1 / step);
  return Math.round(clamp(value, range) * scale) / scale + 0;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Invalid ${name}`);
  return value;
}

function isPresetId(value: unknown): value is EqPresetId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EQ_PRESETS, value);
}

function bands(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== EQ_FREQUENCIES.length) throw new TypeError('Invalid bands');
  return value.map((gain) => num(gain, EQ_GAIN_RANGE, 0.1, 'band gain'));
}

function bassBoost(value: unknown, current: BassBoost): BassBoost {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid bass boost');
  const raw = value as Record<string, unknown>;
  return {
    gain: raw.gain === undefined ? current.gain : num(raw.gain, BASS_GAIN, 0.1, 'bass gain'),
    frequency: raw.frequency === undefined ? current.frequency : num(raw.frequency, BASS_FREQUENCY, 1, 'bass frequency'),
  };
}

function sameBands(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((gain, i) => gain === b[i]);
}

function copy(settings: TabAudioSettings): TabAudioSettings {
  return { ...settings, bands: [...settings.bands], bassBoost: { ...settings.bassBoost } };
}

export function isDefaultAudio(settings: TabAudioSettings): boolean {
  return JSON.stringify(settings) === JSON.stringify(DEFAULT_TAB_AUDIO);
}

/**
 * Merges an untrusted patch (chrome IPC) into `current`. Wrong types throw; numbers are clamped.
 * Picking a preset without bands loads its bands (and its bass boost, when it has one); editing
 * bands without naming a preset keeps the preset only while they still match it.
 */
export function applyAudioPatch(current: TabAudioSettings, patch: unknown): TabAudioSettings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Invalid patch');
  const raw = patch as Record<string, unknown>;
  const next = copy(current);
  if (raw.volume !== undefined) next.volume = num(raw.volume, VOLUME_RANGE, 0.001, 'volume');
  if (raw.balance !== undefined) next.balance = num(raw.balance, { min: -1, max: 1 }, 0.001, 'balance');
  if (raw.mono !== undefined) next.mono = bool(raw.mono, 'mono');
  if (raw.eqEnabled !== undefined) next.eqEnabled = bool(raw.eqEnabled, 'eqEnabled');
  if (raw.compressor !== undefined) next.compressor = bool(raw.compressor, 'compressor');
  if (raw.bassBoost !== undefined) next.bassBoost = bassBoost(raw.bassBoost, next.bassBoost);
  if (raw.preset !== undefined && raw.preset !== null && !isPresetId(raw.preset)) throw new TypeError('Invalid preset');
  const preset = raw.preset as EqPresetId | null | undefined;
  if (raw.bands !== undefined) {
    next.bands = bands(raw.bands);
    if (preset !== undefined) next.preset = preset;
    else if (next.preset && !sameBands(next.bands, EQ_PRESETS[next.preset].bands)) next.preset = null;
  } else if (preset) {
    next.preset = preset;
    next.bands = [...EQ_PRESETS[preset].bands];
    const boost = EQ_PRESETS[preset].bassBoost;
    if (boost && raw.bassBoost === undefined) next.bassBoost = bassBoost(boost, next.bassBoost);
  } else if (preset === null) {
    next.preset = null;
  }
  return next;
}

/** Validates a saved entry (session file); anything invalid falls back to the default. */
function parseSaved(value: unknown): TabAudioSettings | null {
  try {
    return applyAudioPatch(DEFAULT_TAB_AUDIO, value);
  } catch {
    return null;
  }
}

export function tabAudioSettings(tabId: number): TabAudioSettings | null {
  return store.get(tabId) ?? null;
}

export function settingsOf(tabId: number): TabAudioSettings {
  return copy(store.get(tabId) ?? DEFAULT_TAB_AUDIO);
}

export function audioTabIds(): number[] {
  return [...store.keys()];
}

export function setTabAudio(tabId: number, settings: TabAudioSettings): void {
  const previous = store.get(tabId);
  if (isDefaultAudio(settings)) {
    if (!store.delete(tabId)) return;
  } else {
    if (previous && JSON.stringify(previous) === JSON.stringify(settings)) return;
    store.set(tabId, copy(settings));
  }
  emit(tabId);
}

export function restoreTabAudio(tabId: number, saved: unknown): void {
  if (saved === undefined) return;
  const settings = parseSaved(saved);
  if (settings) setTabAudio(tabId, settings);
}

export function forgetTabAudio(tabId: number): void {
  if (store.delete(tabId)) emit(tabId);
}

export function onTabAudioChanged(listener: (tabId: number) => void): void {
  listeners.add(listener);
}
