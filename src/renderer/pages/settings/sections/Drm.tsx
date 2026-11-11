import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { DrmStatus } from '@shared/drm';
import { Button } from '@/components/ui/button';
import { velaPages } from '@/lib/vela';
import { Group, Row, SwitchRow } from '../components/layout';
import { errorText, hasBridge, useSettings } from '../store';
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
      setError('Der DRM-Status kann hier nicht gelesen werden. Öffne diese Einstellungen in Vela.');
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
      setStatus(null);
      setLoading(false);
      setError('Der DRM-Status konnte nicht geladen werden. Versuche es erneut.');
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

  useEffect(() => {
    setRestartError(null);
  }, [settings.drmEnabled, status?.restartRequired, status?.failure]);

  const restart = async (): Promise<void> => {
    if (restarting) return;
    setRestarting(true);
    setRestartError(null);
    try {
      await velaPages().relaunch();
    } catch (cause) {
      setRestarting(false);
      setRestartError(errorText(cause, 'Vela konnte nicht neu gestartet werden. Bitte starte Vela manuell neu.'));
    }
  };

  return (
    <Group title="Geschützte Inhalte">
      <fieldset disabled={!bridgeAvailable} className="m-0 min-w-0 border-0 p-0">
        <SwitchRow
          title="Geschützte Inhalte (DRM)"
          description="Ermöglicht die Wiedergabe geschützter Videos auf unterstützten Streaming-Websites, beispielsweise Netflix."
          setting="drmEnabled"
        />
      </fieldset>
      <div role="status" aria-live="polite" aria-atomic="true" aria-busy={loading || view?.kind === 'saving'}>
        <Row
          title={error ? 'Status nicht verfügbar' : view?.title ?? 'Status wird geladen …'}
          description={error ?? view?.description ?? 'Die DRM-Verfügbarkeit wird geprüft.'}
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
              {loading ? 'Wird geprüft …' : 'Erneut versuchen'}
            </Button>
          ) : view?.canRestart ? (
            <Button
              type="button"
              size="sm"
              disabled={restarting}
              onClick={() => void restart()}
              className="h-8 gap-1.5 rounded-lg px-2.5 text-xs font-semibold"
            >
              <RotateCw className="size-3.5" strokeWidth={1.75} aria-hidden />
              {restarting ? 'Wird neu gestartet …' : 'Vela neu starten'}
            </Button>
          ) : null}
        </Row>
      </div>
      {restartError && <p role="alert" className="px-4 py-3 text-xs leading-5 text-destructive">{restartError}</p>}
      <div className="space-y-2 px-4 py-3 text-xs leading-5 text-muted-foreground">
        <p>Für einige Streamingdienste ist DRM erforderlich. Bei Aktivierung können zusätzliche Komponenten zum Schutz geschützter Inhalte verwendet werden.</p>
        <details className="group">
          <summary className="w-fit cursor-pointer rounded-sm text-foreground outline-none transition-colors hover:text-space focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            Datenschutz und Einschränkungen
          </summary>
          <div className="mt-2 space-y-2">
            <p>Diese Zustimmung gilt nur auf diesem Gerät. Nach Aktivierung und Neustart kann die Widevine-Komponente von Google heruntergeladen und aktualisiert werden. Dabei können Geräte- oder Inhaltskennungen übermittelt werden.</p>
            <p>Vela beschränkt DRM-Berechtigungen auf HTTPS-Websites in regulären Spaces. Die native DRM-Komponente gilt für die gesamte App. Normale HTML5-Videos bleiben unabhängig von dieser Option nutzbar.</p>
            <p>Eine vollständige DRM-Isolation zwischen Spaces ist nicht möglich. Auch Burner-Seiten können unter Umständen auf die Komponente zugreifen. Für eine vollständige Widevine-Sperre schalte DRM aus und starte Vela neu.</p>
            <p>Die Verfügbarkeit hängt zusätzlich vom Streamingdienst ab. Netflix-Wiedergabe wurde nicht verifiziert.</p>
          </div>
        </details>
      </div>
    </Group>
  );
}
