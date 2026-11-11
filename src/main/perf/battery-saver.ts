import { powerMonitor } from 'electron';
import { BATTERY_IPC, type BatterySaverState } from '../../shared/battery';
import { getSettings, onSettingsChanged } from '../settings';
import { sendToChrome } from '../window';
import { forcedReading, parseBatteryLevel, resolveBatterySaver, type PowerReading } from './battery-policy';

/**
 * Battery saver state. The power source comes from Electron's powerMonitor (Windows, macOS, Linux
 * via UPower). Electron has no battery level API, so for "Below 20 %" the chrome UI reads
 * navigator.getBattery() and reports the level (only while that mode is selected).
 * VELA_FORCE_BATTERY=1|0 and VELA_FORCE_BATTERY_LEVEL=0..1 override the reading for testing.
 */

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

const forced = forcedReading(process.env);
let reading: PowerReading = { onBattery: forced.onBattery ?? false, level: forced.level ?? null };
let active = false;
let started = false;

function setOnBattery(onBattery: boolean): void {
  if (forced.onBattery !== undefined) return;
  reading = { ...reading, onBattery };
  recompute();
}

const onBatteryListener = (): void => setOnBattery(true);
const onAcListener = (): void => setOnBattery(false);

export function batterySaverState(): BatterySaverState {
  return { active, mode: getSettings().batterySaver, onBattery: reading.onBattery, level: reading.level };
}

function recompute(): void {
  const next = resolveBatterySaver(getSettings().batterySaver, reading);
  if (next === active) return;
  active = next;
  sendToChrome(BATTERY_IPC.changed, batterySaverState());
}

/** Whether battery saver is currently on (false before initBatterySaver). */
export function isBatterySaverActive(): boolean {
  return active;
}

/** Call after app 'ready' (powerMonitor is unusable before). */
export function initBatterySaver(): void {
  if (started) return;
  started = true;
  if (forced.onBattery === undefined) {
    try {
      reading = { ...reading, onBattery: powerMonitor.isOnBatteryPower() };
      powerMonitor.on('on-battery', onBatteryListener);
      powerMonitor.on('on-ac', onAcListener);
    } catch {
      /* powerMonitor unavailable: assume AC */
    }
  }
  onSettingsChanged(() => {
    const before = active;
    recompute();
    if (before === active) sendToChrome(BATTERY_IPC.changed, batterySaverState());
  });
  recompute();
}

export function registerBatteryIpc(handle: ChromeHandler): void {
  handle(BATTERY_IPC.state, () => batterySaverState());
  handle(BATTERY_IPC.report, (level) => {
    if (forced.level !== undefined) return;
    reading = { ...reading, level: parseBatteryLevel(level) };
    recompute();
  });
}
