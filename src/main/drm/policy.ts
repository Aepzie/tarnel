export function drmLaunchPolicy(consent: boolean, hasRuntime: boolean, platform: string, arch: string) {
  const supported = ['win32', 'darwin', 'linux'].includes(platform) && ['x64', 'arm64'].includes(arch);
  const enabled = consent === true && hasRuntime && supported;
  return { enabled, supported, componentUpdates: enabled };
}

export function drmHeaderPolicyRequired(launch: { enabled: boolean }): boolean {
  return launch.enabled;
}

export interface DrmPermissionRequest {
  enabled: boolean;
  ready: boolean;
  ephemeral: boolean;
  isMainFrame: boolean;
  requestingUrl: string | undefined;
  topUrl: string | undefined;
}

export function allowsDrmPermission(request: DrmPermissionRequest): boolean {
  if (!request.enabled || !request.ready || request.ephemeral || !request.isMainFrame) return false;
  try {
    const origin = new URL(request.requestingUrl ?? '');
    const top = new URL(request.topUrl ?? '');
    return origin.protocol === 'https:' && top.protocol === 'https:' &&
      !origin.username && !origin.password && !top.username && !top.password && origin.origin === top.origin;
  } catch {
    return false;
  }
}
