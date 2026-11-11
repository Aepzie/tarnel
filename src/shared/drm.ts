/** DRM consent is device-local. CDM availability never implies streaming-service approval. */
export type DrmState = 'disabled' | 'restart-required' | 'initializing' | 'available' | 'unavailable' | 'unsupported';
export type DrmFailure = 'runtime-missing' | 'component-failed' | 'component-timeout' | 'eme-unavailable' | 'startup-blocked' | null;

export interface DrmStatus {
  enabled: boolean;
  enabledAtStartup: boolean;
  state: DrmState;
  runtime: 'castlabs' | 'standard';
  componentVersion: string | null;
  emeAvailable: boolean;
  restartRequired: boolean;
  failure: DrmFailure;
  platform: string;
  /** A CDM probe does not test a streaming account or its license server. */
  serviceVerified: false;
}

export const DRM_IPC = {
  status: 'pages:drm-status',
  changed: 'pages-event:drm',
} as const;
