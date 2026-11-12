import type { DrmStatus } from '@shared/drm';

export interface DrmPresentation {
  kind: 'saving' | 'restart' | 'unavailable' | 'available' | 'disabled' | 'loading';
  title: string;
  description: string;
  canRestart: boolean;
}

/** Keep an optimistic switch change from displaying a stale success or restart action. */
export function drmPresentation(status: DrmStatus, selectedEnabled: boolean): DrmPresentation {
  if (status.enabled !== selectedEnabled) {
    return { kind: 'saving', title: 'Saving setting…', description: 'Updating DRM status.', canRestart: false };
  }
  if (status.enabled && (status.failure === 'runtime-missing' || status.state === 'unsupported')) {
    return {
      kind: 'unavailable',
      title: 'Unavailable',
      description: 'This Tarnel build does not include a supported DRM runtime. Enabling this setting alone cannot provide protected playback.',
      canRestart: false,
    };
  }
  if (status.restartRequired || status.state === 'restart-required') {
    return {
      kind: 'restart',
      title: 'Restart required',
      description: status.enabled
        ? 'Restart Tarnel to enable DRM and check availability.'
        : 'This change takes effect after a restart. Protected content can continue to use DRM until then.',
      canRestart: true,
    };
  }
  if (status.state === 'disabled') {
    return {
      kind: 'disabled',
      title: 'Disabled',
      description: 'Widevine playback is disabled. Ordinary HTML5 videos remain available.',
      canRestart: false,
    };
  }
  if (status.state === 'initializing') {
    return {
      kind: 'loading',
      title: 'Preparing DRM…',
      description: 'The playback component is being loaded and checked. This may take a moment.',
      canRestart: false,
    };
  }
  if (status.state === 'available') {
    return {
      kind: 'available',
      title: 'DRM component available',
      description: 'The local DRM check passed. Reload any streaming pages already open. Netflix playback has not been verified; individual services may still reject Tarnel.',
      canRestart: false,
    };
  }
  const description = status.failure === 'component-timeout'
    ? 'The playback component did not become ready in time. Check your connection and restart Tarnel if needed.'
    : status.failure === 'component-failed'
      ? 'The playback component could not be loaded. Protected playback is currently unavailable.'
      : status.failure === 'startup-blocked'
        ? 'DRM was blocked at startup. Restart Tarnel to check activation again.'
        : 'The playback component could not provide protected playback. DRM is currently unavailable.';
  return { kind: 'unavailable', title: 'Unavailable', description, canRestart: status.failure === 'startup-blocked' };
}
