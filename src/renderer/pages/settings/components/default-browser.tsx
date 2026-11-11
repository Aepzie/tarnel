import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { DefaultBrowserStatus } from '@shared/default-browser';
import { Button } from '@/components/ui/button';
import { velaPages } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { Row } from './layout';
import { errorText, hasBridge } from '../store';

/** Re-read on mount and whenever the page becomes visible again (the user may come back from Windows Settings). */
function useDefaultBrowserStatus(): [DefaultBrowserStatus | null, () => void] {
  const [status, setStatus] = useState<DefaultBrowserStatus | null>(null);

  const load = useCallback((): void => {
    const api = hasBridge() ? velaPages().defaultBrowser : undefined;
    if (!api || document.hidden) return;
    api.status().then(setStatus, () => undefined);
  }, []);

  useEffect(() => {
    const listeners = new AbortController();
    document.addEventListener('visibilitychange', load, { signal: listeners.signal });
    window.addEventListener('focus', load, { signal: listeners.signal });
    load();
    return () => listeners.abort();
  }, [load]);

  return [status, load];
}

function describe(status: DefaultBrowserStatus, opened: boolean): string {
  if (status.isDefault) return 'Links and web pages from other apps open in Vela.';
  if (status.support === 'dev') return 'Not available in a development build — install Vela to make it the default.';
  if (status.support === 'portable') return 'The portable version can’t be the default browser. Use the installer instead.';
  if (status.support === 'unsupported') return 'Not supported on this system.';
  if (opened) return 'Choose Vela in Windows Settings, then come back here.';
  if (status.method === 'settings') return 'Opens Windows Settings, where you choose Vela for web links, HTML and PDF files.';
  return 'Open links and web pages from other apps in Vela.';
}

/** Settings → General: whether Vela is the default browser, and "Make default". */
export function DefaultBrowserRow() {
  const [status, reload] = useDefaultBrowserStatus();
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status) return null;

  const makeDefault = (): void => {
    const api = velaPages().defaultBrowser;
    if (!api) return;
    setBusy(true);
    setError(null);
    api
      .makeDefault()
      .then((result) => {
        setOpened(result === 'opened-settings');
        reload();
      })
      .catch((e: unknown) => setError(errorText(e, 'Could not open the default apps settings.')))
      .finally(() => setBusy(false));
  };

  return (
    <Row
      title="Default browser"
      description={
        <span role="status" aria-live="polite" className={cn(error && 'text-destructive')}>
          {error ?? describe(status, opened)}
        </span>
      }
    >
      {status.isDefault ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5" strokeWidth={2} aria-hidden />
          Default
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || status.support !== 'ready'}
          onClick={makeDefault}
          className="h-8 rounded-lg px-3 text-xs active:scale-[0.96]"
        >
          Make default
        </Button>
      )}
    </Row>
  );
}
