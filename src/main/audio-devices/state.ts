import { MEDIA_DEVICE_SLOTS, type MediaDeviceChoice, type MediaDeviceSlot, type TabMediaDevices } from '../../shared/types';

/**
 * Per-tab device choices and microphone use. Pure state (no Electron, no tabs.ts import) so tabs.ts
 * can read it for TabState / session files without an import cycle; index.ts does the wiring.
 */
const choices = new Map<number, TabMediaDevices>();
const micTabs = new Set<number>();
/** 'devices' = the tab's route changed; 'mic' = only its microphone indicator. */
export type TabMediaChange = 'devices' | 'mic';
const listeners = new Set<(tabId: number, change: TabMediaChange) => void>();

const MAX_LABEL = 256;

function emit(tabId: number, change: TabMediaChange): void {
  for (const listener of listeners) {
    try {
      listener(tabId, change);
    } catch {
      /* ignore listener errors */
    }
  }
}

function index(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 64 ? value : null;
}

/** Validates untrusted input (IPC, session file). */
export function parseChoice(value: unknown): MediaDeviceChoice | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const ordinal = index(raw.ordinal);
  const position = index(raw.index);
  if (typeof raw.label !== 'string' || !raw.label || raw.label.length > MAX_LABEL || ordinal === null || position === null) return null;
  return { label: raw.label, ordinal, index: position };
}

export function isMediaSlot(value: unknown): value is MediaDeviceSlot {
  return typeof value === 'string' && (MEDIA_DEVICE_SLOTS as readonly string[]).includes(value);
}

export function tabMediaDevices(tabId: number): TabMediaDevices | null {
  return choices.get(tabId) ?? null;
}

export function routedTabIds(): number[] {
  return [...choices.keys()];
}

export function setTabMediaDevice(tabId: number, slot: MediaDeviceSlot, choice: MediaDeviceChoice | null): void {
  const next: TabMediaDevices = { ...choices.get(tabId) };
  if (choice) next[slot] = choice;
  else delete next[slot];
  if (Object.keys(next).length > 0) choices.set(tabId, next);
  else if (!choices.delete(tabId)) return;
  emit(tabId, 'devices');
}

export function restoreTabMediaDevices(tabId: number, saved: unknown): void {
  if (!saved || typeof saved !== 'object') return;
  const next: TabMediaDevices = {};
  for (const slot of MEDIA_DEVICE_SLOTS) {
    const choice = parseChoice((saved as Record<string, unknown>)[slot]);
    if (choice) next[slot] = choice;
  }
  if (Object.keys(next).length === 0) return;
  choices.set(tabId, next);
  emit(tabId, 'devices');
}

export function isMicActive(tabId: number): boolean {
  return micTabs.has(tabId);
}

export function setMicActive(tabId: number, active: boolean): void {
  if (micTabs.has(tabId) === active) return;
  if (active) micTabs.add(tabId);
  else micTabs.delete(tabId);
  emit(tabId, 'mic');
}

export function forgetTab(tabId: number): void {
  if (choices.delete(tabId)) emit(tabId, 'devices');
  if (micTabs.delete(tabId)) emit(tabId, 'mic');
}

export function onTabMediaChanged(listener: (tabId: number, change: TabMediaChange) => void): void {
  listeners.add(listener);
}
