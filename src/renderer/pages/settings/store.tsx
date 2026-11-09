import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, type Settings, type SpaceColor } from '@shared/types';
import { AlertCircle, RotateCw } from 'lucide-react';
import { applyTheme, velaPages } from '@/lib/vela';
import { Button } from '@/components/ui/button';

/** True when running as a vela:// page with the pages bridge available. */
export const hasBridge = (): boolean => typeof window.velaPages !== 'undefined';

/** Electron wraps thrown errors as "Error invoking remote method 'x': Error: msg" — keep only msg. */
export function errorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const clean = raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(\w*Error):\s*/, '').trim();
  return clean || fallback;
}

export type BooleanSettingKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

interface SettingsStore {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  /** Increments on every successful write; drives the inline "Saved" mark. */
  savedTick: number;
  markSaved: () => void;
}

const SettingsContext = createContext<SettingsStore | null>(null);

export function useSettings(): SettingsStore {
  const store = useContext(SettingsContext);
  if (!store) throw new Error('useSettings must be used inside <SettingsProvider>');
  return store;
}

export function SettingsProvider({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(() => (hasBridge() ? null : { ...DEFAULT_SETTINGS }));
  const [savedTick, setSavedTick] = useState(0);
  const [accent, setAccent] = useState<SpaceColor | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const writeSeq = useRef(0);

  useEffect(() => {
    if (!hasBridge()) return;
    let alive = true;
    setLoadError(null);
    velaPages()
      .getSettings()
      .then(
        (loaded) => alive && setSettings(loaded),
        (error) => alive && setLoadError(errorText(error, 'Vela could not read your settings.')),
      );
    return () => {
      alive = false;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (!hasBridge()) return;
    let alive = true;
    velaPages()
      .currentSpace?.()
      .then((space) => alive && space && setAccent(space.color), () => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const theme = settings?.theme;
  useEffect(() => {
    if (!theme) return;
    applyTheme(theme, accent);
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const listeners = new AbortController();
    query.addEventListener('change', () => applyTheme('system', accent), { signal: listeners.signal });
    return () => listeners.abort();
  }, [theme, accent]);

  const markSaved = useCallback(() => setSavedTick((tick) => tick + 1), []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((current) => (current ? { ...current, ...patch } : current));
      if (!hasBridge()) {
        markSaved();
        return;
      }
      const seq = ++writeSeq.current;
      velaPages()
        .setSettings(patch)
        .then(
          (next) => {
            if (seq !== writeSeq.current) return;
            setSettings(next);
            markSaved();
          },
          () => {
            if (seq !== writeSeq.current) return;
            velaPages()
              .getSettings()
              .then((next) => setSettings(next), () => undefined);
          },
        );
    },
    [markSaved],
  );

  const store = useMemo<SettingsStore | null>(
    () => (settings ? { settings, update, savedTick, markSaved } : null),
    [settings, update, savedTick, markSaved],
  );

  if (!store && loadError) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-xl bg-card/50 px-4 py-3 ring-1 ring-border">
        <AlertCircle className="size-4 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-5 font-medium text-foreground">Settings didn’t load</p>
          <p className="text-xs leading-5 text-muted-foreground">{loadError}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          className="h-8 gap-1.5 rounded-lg px-2.5 text-xs active:scale-[0.96]"
        >
          <RotateCw className="size-3.5" strokeWidth={1.75} aria-hidden />
          Retry
        </Button>
      </div>
    );
  }
  if (!store) return <>{fallback}</>;
  return <SettingsContext.Provider value={store}>{children}</SettingsContext.Provider>;
}
