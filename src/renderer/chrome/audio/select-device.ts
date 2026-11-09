import type { MediaDeviceSlot } from '@shared/types';
import { settle, vela } from '@/lib/vela';
import { DEFAULT_KEY } from './device-sections';
import type { DeviceOption } from './device-store';

/** Route a tab's slot to the option with `key` (DEFAULT_KEY = back to "System default"). */
export function selectDevice(tabId: number, slot: MediaDeviceSlot, key: string, options: readonly DeviceOption[]): void {
  if (key === DEFAULT_KEY) {
    settle(vela().mediaDevices.set(tabId, slot, null));
    return;
  }
  const option = options.find((candidate) => candidate.key === key);
  if (option) settle(vela().mediaDevices.set(tabId, slot, option.choice));
}
