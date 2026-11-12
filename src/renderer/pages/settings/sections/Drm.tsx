import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { DrmStatus } from '@shared/drm';
import { Button } from '@/components/ui/button';
import { velaPages } from '@/lib/vela';
import { Group, Row, SwitchRow } from '../components/layout';
import { hasBridge, useSettings } from '../store';
import { drmPresentation } from './drm-presentation';

function useDrmStatus(enabled: boolean, attempt: number) {
  const [status, setStatus] = useState<DrmStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bridgeAvailable = hasBridge() && typeof window.velaPages.drm?.status === 'function';

  useEffect(() => {
    if (!bridgeAvailable) {
      setStatus(null);
      setLoading(false);
      setError('Open these settings in Tarnel to check DRM.');
      return;
    }
    let alive = true;
    let revision = 0;
    const api = velaPages().drm;
    const receive = (next: DrmStatus): void => {
      if (!alive) return;
      revision += 1;
      setStatus(next);
      setError(null);
      setLoading(false);
    };
    const fail = (): void => {
      if (!alive) return;
      setLoading(false);
      setError("Couldn't load DRM status. Try again.");
    };
    const load = (): void => {
      const request = ++revision;
      setLoading(true);
      Promise.resolve().then(() => api.status()).then(
        (next) => { if (alive && request === revision) receive(next); },
        () => { if (alive && request === revision) fail(); },
      );
    };
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = api.onStatus(receive);
      load();
    } catch {
      fail();
    }
    const listeners = new AbortController();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); }, { signal: listeners.signal });
    window.addEventListener('focus', load, { signal: listeners.signal });
    return () => {
      alive = false;
      listeners.abort();
      unsubscribe?.();
    };
  }, [bridgeAvailable, enabled, attempt]);

  return { status, error, loading, bridgeAvailable };
}

/** Device-local DRM consent and actual playback-component status, inside Privacy. */
export function Drm() {
  const { settings } = useSettings();
  const [attempt, setAttempt] = useState(0);
  const { status, error, loading, bridgeAvailable } = useDrmStatus(settings.drmEnabled, attempt);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const view = status ? drmPresentation(status, settings.drmEnabled) : null;
  const showStatus = view?.visible ?? settings.drmEnabled;

  useEffect(() => {
    setRestartError(null);
  }, [settings.drmEnabled, status?.restartRequired, status?.failure]);

  const restart = async (): Promise<void> => {
    if (restarting) return;
    setRestarting(true);
    setRestartError(null);
    try {
      await velaPages().relaunch();
    } catch {
      setRestarting(false);
      setRestartError("Couldn't restart. Restart Tarnel manually.");
    }
  };

  return (
    <Group title="DRM">
      <SwitchRow
        title="Protected content (DRM)"
        description="Play DRM-protected video on streaming sites. Needs a restart."
        setting="drmEnabled"
        disabled={!bridgeAvailable}
      />
      {showStatus && <div role="status" aria-live="polite" aria-atomic="true" aria-busy={loading || view?.kind === 'saving'}>
        <Row
          title={error ? 'Status unavailable' : view?.title ?? 'Loading status…'}
          description={error ?? view?.description ?? 'Checking DRM availability.'}
          className="flex-col items-start gap-3 sm:flex-row sm:items-center"
        >
          {error && bridgeAvailable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => setAttempt((current) => current + 1)}
              className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
            >
              <RotateCw className="size-3.5" strokeWidth={1.75} aria-hidden />
              {loading ? 'Checking…' : 'Retry'}
            </Button>
          ) : view?.canRestart ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={restarting}
              onClick={() => void restart()}
              className="h-8 gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RotateCw className="size-3.5" strokeWidth={1.75} aria-hidden />
              {restarting ? 'Restarting…' : 'Restart Tarnel'}
            </Button>
          ) : null}
        </Row>
      </div>}
      {restartError && <p role="alert" className="px-4 py-3 text-xs leading-5 text-destructive">{restartError}</p>}
      <p className="px-4 py-3 text-xs leading-5 text-muted-foreground">
        Downloads Google's Widevine component, which may send device identifiers. Applies to the whole app, including Burner Spaces.
      </p>
    </Group>
  );
}
