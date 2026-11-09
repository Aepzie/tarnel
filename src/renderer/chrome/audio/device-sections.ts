import type { MediaDeviceSlot, TabState } from '@shared/types';
import { choiceKey, isConnected, splitLabel, useDeviceList, type DeviceList, type DeviceOption } from './device-store';

export const DEFAULT_KEY = 'default';

export const SLOT_TITLES: Record<MediaDeviceSlot, string> = {
  output: 'Output',
  input: 'Microphone',
  camera: 'Camera',
};

export interface DeviceSection {
  slot: MediaDeviceSlot;
  options: DeviceOption[];
  defaultName: string | null;
  /** The tab's pick when it is unplugged (the tab plays on the default meanwhile). */
  missing: DeviceOption | null;
}

/** Radio value of a slot: the picked device's key, or DEFAULT_KEY. */
export function slotValue(tab: TabState, slot: MediaDeviceSlot): string {
  const choice = tab.devices?.[slot];
  return choice ? choiceKey(choice) : DEFAULT_KEY;
}

export function sectionsOf(tab: TabState, list: DeviceList, slots: readonly MediaDeviceSlot[]): DeviceSection[] {
  return slots
    .filter((slot) => slot !== 'camera' || list.options.camera.length > 0 || tab.devices?.camera)
    .map((slot) => {
      const choice = tab.devices?.[slot];
      const missing = choice && !isConnected(list, slot, choice) ? { key: choiceKey(choice), label: choice.label, ...splitLabel(choice.label), choice } : null;
      return { slot, options: list.options[slot], defaultName: list.defaults[slot], missing };
    });
}

export function useDeviceSections(tab: TabState, active: boolean, slots: readonly MediaDeviceSlot[] = ['output', 'input', 'camera']): DeviceSection[] {
  return sectionsOf(tab, useDeviceList(active), slots);
}

/** Slots whose picked device is unplugged right now. */
export function missingSlots(tab: TabState, list: DeviceList): MediaDeviceSlot[] {
  const devices = tab.devices;
  if (!devices) return [];
  return (Object.keys(devices) as MediaDeviceSlot[]).filter((slot) => !isConnected(list, slot, devices[slot]!));
}
