import type { DrmStatus } from '@shared/drm';

export interface DrmPresentation {
  kind: 'saving' | 'restart' | 'unavailable' | 'available' | 'disabled' | 'loading';
  title: string;
  description: string;
  canRestart: boolean;
  visible: boolean;
}

/** Keep an optimistic switch change from displaying a stale success or restart action. */
export function drmPresentation(status: DrmStatus, selectedEnabled: boolean): DrmPresentation {
  if (status.enabled !== selectedEnabled) {
    return { kind: 'saving', title: 'Saving…', description: 'Updating DRM status.', canRestart: false, visible: true };
  }
  if (status.runtime === 'standard' || status.failure === 'runtime-missing' || status.state === 'unsupported') {
    return {
      kind: 'unavailable',
      title: 'Unavailable',
      description: "This build of Tarnel can't play protected content.",
      canRestart: false,
      visible: selectedEnabled,
    };
  }
  if (status.restartRequired || status.state === 'restart-required') {
    return {
      kind: 'restart',
      title: 'Restart required',
      description: status.enabled
        ? 'Restart Tarnel to turn on DRM.'
        : 'Restart Tarnel to turn off DRM. Open pages can still use it until then.',
      canRestart: true,
      visible: true,
    };
  }
  if (status.state === 'disabled') {
    return {
      kind: 'disabled',
      title: 'Disabled',
      description: '',
      canRestart: false,
      visible: false,
    };
  }
  if (status.state === 'initializing') {
    return {
      kind: 'loading',
      title: 'Loading…',
      description: 'Loading the Widevine component…',
      canRestart: false,
      visible: true,
    };
  }
  if (status.state === 'available') {
    return {
      kind: 'available',
      title: 'Ready',
      description: 'Reload open streaming pages. Some services may still block Tarnel.',
      canRestart: false,
      visible: true,
    };
  }
  const description = status.failure === 'component-timeout'
    ? "Widevine didn't load in time. Check your connection and restart Tarnel to retry."
    : status.failure === 'component-failed'
      ? "Couldn't load Widevine. Check your connection and restart Tarnel."
      : status.failure === 'startup-blocked'
        ? 'DRM was blocked at startup. Restart Tarnel to retry.'
        : "Couldn't play protected content. Restart Tarnel to retry.";
  return { kind: 'unavailable', title: 'Unavailable', description, canRestart: status.failure === 'startup-blocked' || status.failure === 'component-timeout', visible: selectedEnabled };
}
