import { useEffect, useState } from 'react';
import type { VelaUpdatesAPI } from '@shared/ipc';
import type { UpdateStatus } from '@shared/types';

/** Live auto-update status from main (chrome: `vela.updates`, settings: `velaPages.updates`). */
export function useUpdateStatus(api: VelaUpdatesAPI | undefined): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    const unsubscribe = api.onStatus((next) => alive && setStatus(next));
    api.get().then((next) => alive && setStatus((current) => current ?? next), () => undefined);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [api]);

  return status;
}

export function formatRate(bytesPerSecond: number | undefined): string {
  if (!bytesPerSecond) return '';
  const mb = bytesPerSecond / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}

/** Why this build only notifies instead of installing (one short sentence). */
export function notifyReasonText(status: UpdateStatus): string {
  switch (status.reason) {
    case 'portable':
      return 'The portable version can’t update itself. Download the new build from GitHub.';
    case 'mac-unsigned':
      return 'This build isn’t signed, so macOS can’t update it in place. Download the new build from GitHub.';
    case 'linux-package':
      return 'Install the new package from GitHub or your package manager.';
    case 'dev':
      return 'Development build — updates are only checked, never installed.';
    default:
      return 'Download the new build from GitHub.';
  }
}
