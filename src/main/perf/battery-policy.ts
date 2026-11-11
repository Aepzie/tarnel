import type { BatterySaverMode } from '../../shared/battery';
import type { MemorySaverMode } from '../../shared/types';

/** Pure battery saver policy: whether it is active and what it changes. */

export const LOW_BATTERY_LEVEL = 0.2;
/** Freeze and sleep delays are divided by this while battery saver is active. */
export const BATTERY_DELAY_DIVISOR = 2;
/** The adblock list refresh interval is multiplied by this while battery saver is active. */
export const BATTERY_ADBLOCK_REFRESH_MULTIPLIER = 3;

export interface PowerReading {
  onBattery: boolean;
  /** 0–1, null when unknown. */
  level: number | null;
}

export function resolveBatterySaver(mode: BatterySaverMode, reading: PowerReading): boolean {
  switch (mode) {
    case 'off':
      return false;
    case 'always':
      return true;
    case 'battery':
      return reading.onBattery;
    case 'low':
      return reading.onBattery && reading.level !== null && reading.level < LOW_BATTERY_LEVEL;
  }
}

export function batteryDelayDivisor(active: boolean): number {
  return active ? BATTERY_DELAY_DIVISOR : 1;
}

/** Balanced becomes Maximum; a memory saver the user turned off stays off. */
export function effectiveMemorySaver(mode: MemorySaverMode, active: boolean): MemorySaverMode {
  return active && mode === 'balanced' ? 'maximum' : mode;
}

export function adblockRefreshAfterMs(baseMs: number, active: boolean): number {
  return active ? baseMs * BATTERY_ADBLOCK_REFRESH_MULTIPLIER : baseMs;
}

/** Battery level from renderer input: a finite number clamped to 0–1, otherwise null. */
export function parseBatteryLevel(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/** VELA_FORCE_BATTERY / VELA_FORCE_BATTERY_LEVEL (testing): overrides of the real power reading. */
export function forcedReading(env: Readonly<Record<string, string | undefined>>): Partial<PowerReading> {
  const forced: Partial<PowerReading> = {};
  if (env.VELA_FORCE_BATTERY === '1') forced.onBattery = true;
  if (env.VELA_FORCE_BATTERY === '0') forced.onBattery = false;
  const level = env.VELA_FORCE_BATTERY_LEVEL;
  if (level !== undefined && level !== '') {
    const parsed = parseBatteryLevel(Number(level));
    if (parsed !== null) forced.level = parsed;
  }
  return forced;
}
