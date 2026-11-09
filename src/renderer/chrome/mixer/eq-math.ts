import { EQ_FREQUENCIES, type TabAudioSettings } from '@shared/audio-mixer';

/**
 * Frequency-response math for the EQ graph (RBJ cookbook biquads). The curve shows what the page
 * engine applies: one peaking filter per graphic-EQ band plus a low shelf for the bass boost.
 */
const SAMPLE_RATE = 48_000;
/** One-octave bands. */
export const BAND_Q = 1.41;
/** Butterworth shelf slope (S = 1). */
const SHELF_Q = Math.SQRT1_2;

export const FREQ_MIN = 20;
export const FREQ_MAX = 20_000;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

function peaking(frequency: number, gainDb: number, q: number): Biquad {
  const a = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * frequency) / SAMPLE_RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  return { b0: 1 + alpha * a, b1: -2 * cos, b2: 1 - alpha * a, a0: 1 + alpha / a, a1: -2 * cos, a2: 1 - alpha / a };
}

function lowShelf(frequency: number, gainDb: number, q: number): Biquad {
  const a = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * frequency) / SAMPLE_RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const root = 2 * Math.sqrt(a) * alpha;
  return {
    b0: a * (a + 1 - (a - 1) * cos + root),
    b1: 2 * a * (a - 1 - (a + 1) * cos),
    b2: a * (a + 1 - (a - 1) * cos - root),
    a0: a + 1 + (a - 1) * cos + root,
    a1: -2 * (a - 1 + (a + 1) * cos),
    a2: a + 1 + (a - 1) * cos - root,
  };
}

/** |H(e^jw)| of a biquad in dB at `frequency`. */
function magnitudeDb(filter: Biquad, frequency: number): number {
  const w = (2 * Math.PI * frequency) / SAMPLE_RATE;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const numRe = filter.b0 + filter.b1 * cos1 + filter.b2 * cos2;
  const numIm = -(filter.b1 * sin1 + filter.b2 * sin2);
  const denRe = filter.a0 + filter.a1 * cos1 + filter.a2 * cos2;
  const denIm = -(filter.a1 * sin1 + filter.a2 * sin2);
  const ratio = (numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm);
  return 10 * Math.log10(ratio);
}

/** Filters a tab's settings put in the signal path (bands only while the EQ is on). */
export function filtersOf(settings: Pick<TabAudioSettings, 'eqEnabled' | 'bands' | 'bassBoost'>): Biquad[] {
  const filters: Biquad[] = [];
  if (settings.eqEnabled) {
    EQ_FREQUENCIES.forEach((frequency, index) => {
      const gain = settings.bands[index] ?? 0;
      if (gain !== 0) filters.push(peaking(frequency, gain, BAND_Q));
    });
  }
  if (settings.bassBoost.gain > 0) filters.push(lowShelf(settings.bassBoost.frequency, settings.bassBoost.gain, SHELF_Q));
  return filters;
}

/** Combined response (dB) of `filters` at `frequency`. */
export function responseDb(filters: readonly Biquad[], frequency: number): number {
  let total = 0;
  for (const filter of filters) total += magnitudeDb(filter, frequency);
  return total;
}

/** 0..1 position of a frequency on the log axis FREQ_MIN–FREQ_MAX. */
export function freqToUnit(frequency: number): number {
  return Math.log(frequency / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN);
}

export function unitToFreq(unit: number): number {
  return FREQ_MIN * (FREQ_MAX / FREQ_MIN) ** unit;
}

/** `count` log-spaced sample frequencies across the axis. */
export function sampleFrequencies(count: number): number[] {
  return Array.from({ length: count }, (_, index) => unitToFreq(index / (count - 1)));
}

export function formatHz(frequency: number): string {
  if (frequency >= 1000) {
    const khz = frequency / 1000;
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)}k`;
  }
  return String(Math.round(frequency));
}

export function formatDb(gain: number): string {
  const rounded = Math.round(gain * 10) / 10;
  if (rounded === 0) return '0 dB';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(Number.isInteger(rounded) ? 0 : 1)} dB`;
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
