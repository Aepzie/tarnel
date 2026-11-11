/**
 * Battery saver (Settings → Performance). Main decides whether it is active (powerMonitor + the
 * battery level the chrome UI reads with navigator.getBattery) and pushes the state to the chrome UI.
 * See docs/PERFORMANCE.md → Battery saver.
 */

export const BATTERY_SAVER_MODES = ['off', 'battery', 'always', 'low'] as const;
/** off · on battery power · always · on battery below 20 %. */
export type BatterySaverMode = (typeof BATTERY_SAVER_MODES)[number];

export interface BatterySaverState {
  active: boolean;
  mode: BatterySaverMode;
  onBattery: boolean;
  /** 0–1 when the platform reports it (and the mode needs it), else null. */
  level: number | null;
}

export const BATTERY_IPC = {
  state: 'chrome:battery-state',
  /** Chrome UI → main: battery level (0–1) or null when unknown. */
  report: 'chrome:battery-report',
  changed: 'chrome-event:battery',
} as const;
