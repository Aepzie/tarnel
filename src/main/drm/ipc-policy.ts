import { INTERNAL_SCHEME } from '../../shared/internal-url';

export function isSettingsPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${INTERNAL_SCHEME}:` && parsed.hostname === 'settings' &&
      !parsed.username && !parsed.password && !parsed.port;
  } catch { return false; }
}

export function isInternalPageSender(frame: { parent: unknown; url: string } | null | undefined, tabId: number | null): boolean {
  return !!frame && frame.parent === null && frame.url.startsWith(`${INTERNAL_SCHEME}://`) && tabId !== null;
}

export function validateDrmSettingsPatch(patch: Record<string, unknown>, source: 'chrome' | 'page', url?: string): void {
  if (!('drmEnabled' in patch)) return;
  if (typeof patch.drmEnabled !== 'boolean') throw new TypeError('Invalid DRM preference');
  if (source === 'page' && !isSettingsPage(url ?? '')) throw new Error('DRM consent requires Settings');
}
