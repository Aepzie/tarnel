import type { MediaDeviceChoice, MediaDeviceSlot } from './types';

/** Synchronous IPC asked by the audio-devices preload in every frame of a routed tab before page scripts run. */
export const MEDIA_ROUTE_CHANNEL = 'vela:media-route';

/** What a tab's frames route to; a missing slot means "System default". Sent to pages as-is (labels only, no ids). */
export type MediaRoute = Partial<Record<MediaDeviceSlot, MediaDeviceChoice>>;

/** `MediaDeviceInfo.kind` of each slot. */
export const SLOT_KIND: Record<MediaDeviceSlot, MediaDeviceKind> = {
  output: 'audiooutput',
  input: 'audioinput',
  camera: 'videoinput',
};

/** Chromium's virtual entries (Windows lists "default" and "communications" next to the real devices). */
export const VIRTUAL_DEVICE_IDS: readonly string[] = ['', 'default', 'communications'];
