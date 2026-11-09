import { useSyncExternalStore } from 'react';
import { SLOT_KIND, VIRTUAL_DEVICE_IDS } from '@shared/audio-devices';
import { MEDIA_DEVICE_SLOTS, type MediaDeviceChoice, type MediaDeviceSlot } from '@shared/types';

export interface DeviceOption {
  /** Stable across origins and restarts: ordinal + label. */
  key: string;
  label: string;
  /** `label` split for display: "Speakers" + "Realtek(R) Audio" (the trailing parenthetical). */
  name: string;
  detail: string;
  choice: MediaDeviceChoice;
}

/** "Lautsprecher (Realtek(R) Audio)" → ["Lautsprecher", "Realtek(R) Audio"]; nested parentheses allowed. */
export function splitLabel(label: string): { name: string; detail: string } {
  const trimmed = label.trim();
  if (!trimmed.endsWith(')')) return { name: trimmed, detail: '' };
  let depth = 0;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i] === ')') depth++;
    else if (trimmed[i] === '(' && --depth === 0) {
      const name = trimmed.slice(0, i).trim();
      return name ? { name, detail: trimmed.slice(i + 1, -1).trim() } : { name: trimmed, detail: '' };
    }
  }
  return { name: trimmed, detail: '' };
}

export interface DeviceList {
  loaded: boolean;
  options: Record<MediaDeviceSlot, DeviceOption[]>;
  /** Name of the device "System default" currently is (null when unknown). */
  defaults: Record<MediaDeviceSlot, string | null>;
}

const EMPTY: DeviceList = {
  loaded: false,
  options: { output: [], input: [], camera: [] },
  defaults: { output: null, input: null, camera: null },
};

/**
 * Devices as the chrome sees them. The chrome is a trusted file:// view whose session answers
 * permission checks, so labels come without prompting. Enumerated only while something is
 * subscribed (an open menu / popover, or a tab with a picked device to watch for unplugging).
 */
let snapshot: DeviceList = EMPTY;
const listeners = new Set<() => void>();
let generation = 0;

export function choiceKey(choice: MediaDeviceChoice): string {
  return `${choice.ordinal}\u0000${choice.label}`;
}

function toList(devices: MediaDeviceInfo[]): DeviceList {
  const options = { output: [], input: [], camera: [] } as Record<MediaDeviceSlot, DeviceOption[]>;
  const defaults = { output: null, input: null, camera: null } as Record<MediaDeviceSlot, string | null>;
  for (const slot of MEDIA_DEVICE_SLOTS) {
    const ofKind = devices.filter((device) => device.kind === SLOT_KIND[slot]);
    const real = ofKind.filter((device) => !VIRTUAL_DEVICE_IDS.includes(device.deviceId));
    const seen = new Map<string, number>();
    options[slot] = real.map((device, index) => {
      const label = device.label || `Device ${index + 1}`;
      const ordinal = seen.get(label) ?? 0;
      seen.set(label, ordinal + 1);
      const choice = { label, ordinal, index };
      return { key: choiceKey(choice), label, ...splitLabel(label), choice };
    });
    const fallback = ofKind.find((device) => device.deviceId === 'default')?.label.replace(/^Default - /, '') ?? real[0]?.label;
    defaults[slot] = fallback ? splitLabel(fallback).name : null;
  }
  return { loaded: true, options, defaults };
}

function refresh(): void {
  const run = ++generation;
  navigator.mediaDevices
    ?.enumerateDevices()
    .then((devices) => {
      if (run !== generation) return;
      snapshot = toList(devices);
      for (const listener of listeners) listener();
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  };
}

const none = (): (() => void) => () => undefined;

/** Live device list; `active = false` subscribes to nothing (and returns the last snapshot). */
export function useDeviceList(active = true): DeviceList {
  return useSyncExternalStore(active ? subscribe : none, () => snapshot);
}

/** Last known list without subscribing (palette); `prime` enumerates once for the next read. */
export function deviceListSnapshot(prime = false): DeviceList {
  if (prime && listeners.size === 0) refresh();
  return snapshot;
}

/** Whether a picked device is currently plugged in (unknown lists count as available). */
export function isConnected(list: DeviceList, slot: MediaDeviceSlot, choice: MediaDeviceChoice): boolean {
  if (!list.loaded) return true;
  const key = choiceKey(choice);
  return list.options[slot].some((option) => option.key === key);
}
