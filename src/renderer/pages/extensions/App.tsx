import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AlertCircle, Check, ExternalLink, Plus, Puzzle, RotateCw, Search, Settings2, Trash, X } from 'lucide-react';
import type { ExtensionInfo, ExtensionReview } from '@shared/types';
import {
  CATALOG_CATEGORIES,
  EXTENSION_CATALOG,
  filterCatalog,
  installHashId,
  storeSearchUrl,
  type CatalogCategory,
  type CatalogEntry,
} from '@shared/extension-catalog';
import { cn } from '@/lib/utils';
import { ease, spring } from '@/lib/motion';
import { velaPages } from '@/lib/vela';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cardClass, ExtensionIcon, HighRiskBadge, ReviewCard } from '@/components/extensions';

type View = 'discover' | 'installed';

const hasBridge = (): boolean => typeof window.velaPages !== 'undefined';

function errorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const clean = raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(\w*Error):\s*/, '').trim();
  return clean || fallback;
}

const CATEGORY_LABEL = new Map(CATALOG_CATEGORIES.map((category) => [category.id, category.label]));

const ghost = 'h-8 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.96]';

function LetterTile({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-muted text-[13px] font-semibold text-muted-foreground ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]"
    >
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

function CategoryChip({ category }: { category: CatalogCategory }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-medium text-muted-foreground ring-1 ring-border ring-inset">
      {CATEGORY_LABEL.get(category)}
    </span>
  );
}

interface Actions {
  busyId: string | null;
  install: (id: string) => void;
  toggle: (extension: ExtensionInfo, enabled: boolean) => void;
  remove: (extension: ExtensionInfo) => void;
  options: (extension: ExtensionInfo) => void;
}

function InstalledControls({ extension, actions }: { extension: ExtensionInfo; actions: Actions }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <div className="flex items-center gap-1">
      {extension.hasOptions && (
        <Button type="button" variant="ghost" size="sm" disabled={!extension.enabled} onClick={() => actions.options(extension)} className={ghost}>
          <Settings2 className="size-3.5" strokeWidth={1.75} aria-hidden />
          Options
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => (confirming ? actions.remove(extension) : setConfirming(true))}
        className={cn(ghost, confirming && 'text-destructive hover:text-destructive')}
      >
        <Trash className="size-3.5" strokeWidth={1.75} aria-hidden />
        {confirming ? 'Confirm remove' : 'Remove'}
      </Button>
      <Switch
        aria-label={`Enable ${extension.name}`}
        checked={extension.enabled}
        onCheckedChange={(enabled) => actions.toggle(extension, enabled)}
        className="ml-1"
      />
    </div>
  );
}

function CatalogCard({ entry, installed, actions }: { entry: CatalogEntry; installed: ExtensionInfo | undefined; actions: Actions }) {
  const busy = actions.busyId === entry.id;
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: spring.soft }}
      exit={{ opacity: 0, transition: { duration: 0.12, ease: ease.out } }}
      aria-label={entry.name}
      className={cn(cardClass, 'flex flex-col')}
    >
      <div className="flex flex-1 items-start gap-3 px-4 pt-4 pb-3">
        {installed ? <ExtensionIcon extension={installed} muted={!installed.enabled} /> : <LetterTile name={entry.name} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] leading-6 font-semibold tracking-tight">{entry.name}</h3>
            {installed && (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-space">
                <Check className="size-3" strokeWidth={2.25} aria-hidden />
                Installed
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{entry.description}</p>
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground/80">{entry.permissions}</p>
        </div>
      </div>
      <footer className="flex h-11 items-center justify-between gap-2 border-t border-border bg-muted/40 py-1.5 pr-2 pl-4">
        <CategoryChip category={entry.category} />
        {installed ? (
          <InstalledControls extension={installed} actions={actions} />
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={actions.busyId !== null || !hasBridge()}
            onClick={() => actions.install(entry.id)}
            className="h-8 gap-1.5 rounded-lg px-3 text-xs active:scale-[0.96]"
          >
            {busy ? (
              <RotateCw className="size-3.5 motion-safe:animate-spin" strokeWidth={2} aria-hidden />
            ) : (
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            )}
            {busy ? 'Downloading…' : 'Install'}
          </Button>
        )}
      </footer>
    </motion.article>
  );
}

function InstalledRow({ extension, actions }: { extension: ExtensionInfo; actions: Actions }) {
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: spring.soft }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14, ease: ease.out } }}
      aria-label={extension.name}
      className={cn(cardClass, 'flex items-center gap-3 py-3 pr-3 pl-4')}
    >
      <ExtensionIcon extension={extension} muted={!extension.enabled} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[14px] leading-6 font-semibold tracking-tight">{extension.name}</h3>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{extension.version}</span>
          <HighRiskBadge risk={extension.risk} />
        </div>
        {extension.error ? (
          <p className="truncate text-xs leading-5 text-destructive">{extension.error}</p>
        ) : (
          <p className="truncate text-xs leading-5 text-muted-foreground">{extension.description || 'No description'}</p>
        )}
      </div>
      <InstalledControls extension={extension} actions={actions} />
    </motion.article>
  );
}

function EmptyNote({ icon, title, body }: { icon: 'puzzle' | 'search'; title: string; body: string }) {
  const Icon = icon === 'puzzle' ? Puzzle : Search;
  return (
    <div className={cn(cardClass, 'flex flex-col items-center gap-2 px-6 py-10 text-center')}>
      <span className="grid size-10 place-items-center rounded-xl bg-muted ring-1 ring-border">
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      </span>
      <p className="text-[13px] font-medium">{title}</p>
      <p className="max-w-80 text-xs leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

function ViewSwitch({ view, installedCount, onChange }: { view: View; installedCount: number; onChange: (next: View) => void }) {
  const options: { id: View; label: string }[] = [
    { id: 'discover', label: 'Discover' },
    { id: 'installed', label: installedCount > 0 ? `Installed · ${installedCount}` : 'Installed' },
  ];
  return (
    <div role="tablist" aria-label="View" className="flex h-8 items-center gap-0.5 rounded-[10px] bg-muted/60 p-0.5 ring-1 ring-border">
      {options.map((option) => {
        const on = option.id === view;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(option.id)}
            className={cn(
              'relative h-7 rounded-lg px-3 text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {on && (
              <motion.span
                layoutId="view-pill"
                transition={spring.soft}
                className="absolute inset-0 -z-10 rounded-lg bg-card ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]"
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function App() {
  const [extensions, setExtensions] = useState<ExtensionInfo[] | null>(hasBridge() ? null : []);
  const [view, setView] = useState<View>('discover');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [review, setReview] = useState<ExtensionReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Extensions';
  }, []);

  const refresh = useCallback(() => {
    if (!hasBridge()) return;
    velaPages()
      .extensions.list()
      .then(setExtensions, (failure) => setError(errorText(failure, 'Could not load extensions')));
  }, []);

  useEffect(() => {
    refresh();
    const listeners = new AbortController();
    window.addEventListener('focus', refresh, { signal: listeners.signal });
    return () => listeners.abort();
  }, [refresh]);

  const upsert = useCallback((next: ExtensionInfo) => {
    setExtensions((list) => {
      const current = list ?? [];
      return current.some((entry) => entry.id === next.id) ? current.map((entry) => (entry.id === next.id ? next : entry)) : [...current, next];
    });
  }, []);

  const install = useCallback((id: string) => {
    if (!hasBridge()) return;
    setBusyId(id);
    setError(null);
    velaPages()
      .extensions.install(id)
      .then(setReview, (failure) => setError(errorText(failure, 'Could not download the extension')))
      .finally(() => setBusyId(null));
  }, []);

  useEffect(() => {
    const fromHash = (): void => {
      const id = installHashId(window.location.hash);
      if (!id) return;
      history.replaceState(null, '', window.location.pathname);
      install(id);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [install]);

  const confirm = (): void => {
    if (!review) return;
    setConfirming(true);
    velaPages()
      .extensions.confirmInstall(review.token)
      .then(upsert, (failure) => setError(errorText(failure, 'Could not add the extension')))
      .finally(() => {
        setConfirming(false);
        setReview(null);
      });
  };

  const cancel = (): void => {
    if (!review) return;
    void velaPages().extensions.cancelInstall(review.token).catch(() => undefined);
    setReview(null);
  };

  const actions: Actions = {
    busyId,
    install,
    toggle: (extension, enabled) => {
      upsert({ ...extension, enabled });
      velaPages()
        .extensions.update(extension.id, { enabled })
        .then(upsert, (failure) => {
          upsert(extension);
          setError(errorText(failure, 'Could not save'));
        });
    },
    remove: (extension) => {
      velaPages()
        .extensions.remove(extension.id)
        .then(
          () => setExtensions((list) => list?.filter((entry) => entry.id !== extension.id) ?? list),
          (failure) => setError(errorText(failure, 'Could not remove')),
        );
    },
    options: (extension) => {
      velaPages()
        .extensions.openOptions(extension.id)
        .catch((failure) => setError(errorText(failure, 'Could not open options')));
    },
  };

  const installedById = useMemo(() => new Map((extensions ?? []).map((extension) => [extension.id, extension])), [extensions]);
  const matches = useMemo(() => filterCatalog(EXTENSION_CATALOG, query), [query]);
  const installedMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = extensions ?? [];
    return needle ? list.filter((extension) => `${extension.name} ${extension.description}`.toLowerCase().includes(needle)) : list;
  }, [extensions, query]);

  const searchStore = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    window.open(storeSearchUrl(query), '_blank', 'noopener');
  };

  useEffect(() => {
    const listeners = new AbortController();
    window.addEventListener(
      'keydown',
      (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          return;
        }
        if (event.key === 'Escape' && review && !confirming) cancel();
      },
      { signal: listeners.signal },
    );
    return () => listeners.abort();
  });

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto w-full max-w-4xl px-8 pt-10 pb-16">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-[11px] bg-card ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]">
                <Puzzle className="size-[17px] text-space" strokeWidth={1.75} />
              </span>
              <div>
                <h1 className="text-[19px] leading-6 font-semibold tracking-tight">Extensions</h1>
                <p className="text-xs leading-5 text-muted-foreground">Picked for privacy. Every install shows its permissions first.</p>
              </div>
            </div>
            <ViewSwitch view={view} installedCount={extensions?.length ?? 0} onChange={setView} />
          </header>

          <form onSubmit={searchStore} autoComplete="off" className="mt-6 flex items-center gap-2">
            <label className="relative flex h-9 min-w-0 flex-1 items-center">
              <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              <input
                ref={searchRef}
                value={query}
                spellCheck={false}
                aria-label="Filter extensions"
                placeholder={view === 'discover' ? 'Filter the catalog' : 'Filter installed'}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-full rounded-[10px] bg-card/60 pr-9 pl-9 text-[13px] ring-1 ring-border outline-none transition-shadow duration-150 placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear"
                  onClick={() => setQuery('')}
                  className="absolute right-2 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" strokeWidth={2} aria-hidden />
                </button>
              )}
            </label>
            <Button type="submit" variant="ghost" size="sm" className="h-9 gap-1.5 rounded-[10px] px-3 text-xs text-muted-foreground ring-1 ring-border hover:text-foreground">
              <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
              Search the Chrome Web Store
            </Button>
          </form>

          <AnimatePresence initial={false}>
            {error && (
              <motion.p
                role="alert"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto', transition: { duration: 0.18, ease: ease.out } }}
                exit={{ opacity: 0, height: 0, transition: { duration: 0.14, ease: ease.out } }}
                className="overflow-hidden"
              >
                <span className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  {error}
                  <button type="button" onClick={() => setError(null)} className="ml-1 text-muted-foreground underline-offset-2 hover:underline">
                    Dismiss
                  </button>
                </span>
              </motion.p>
            )}
          </AnimatePresence>

          {view === 'discover' ? (
            <div className="mt-8 flex flex-col gap-8">
              {matches.length === 0 && (
                <EmptyNote
                  icon="search"
                  title="Not in Vela’s picks"
                  body="Press Enter to search the Chrome Web Store. On a store page, Vela shows an Add to Vela button in the toolbar."
                />
              )}
              {CATALOG_CATEGORIES.map((category) => {
                const entries = matches.filter((entry) => entry.category === category.id);
                if (entries.length === 0) return null;
                return (
                  <section key={category.id} aria-label={category.label}>
                    <h2 className="mb-3 px-1 text-[12px] font-medium tracking-tight text-muted-foreground">{category.label}</h2>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <AnimatePresence mode="popLayout" initial={false}>
                        {entries.map((entry) => (
                          <CatalogCard key={entry.id} entry={entry} installed={installedById.get(entry.id)} actions={actions} />
                        ))}
                      </AnimatePresence>
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="mt-8 flex flex-col gap-3">
              {extensions === null ? (
                <div className={cn(cardClass, 'h-16 motion-safe:animate-pulse')} aria-hidden />
              ) : installedMatches.length === 0 ? (
                <EmptyNote
                  icon="puzzle"
                  title={extensions.length === 0 ? 'No extensions yet' : 'No matches'}
                  body={extensions.length === 0 ? 'Nothing extra runs until you add one. Pick one from Discover.' : 'Try another name.'}
                />
              ) : (
                <AnimatePresence mode="popLayout" initial={false}>
                  {installedMatches.map((extension) => (
                    <InstalledRow key={extension.id} extension={extension} actions={actions} />
                  ))}
                </AnimatePresence>
              )}
              <button
                type="button"
                onClick={() => void velaPages().navigate('vela://settings/#extensions')}
                className="mt-2 self-start px-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Spaces, site access and pinning live in Settings → Extensions
              </button>
            </div>
          )}
        </div>

        <AnimatePresence>
          {review && (
            <motion.div
              key="review"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.16 } }}
              exit={{ opacity: 0, transition: { duration: 0.14 } }}
              className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-6 backdrop-blur-sm"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !confirming) cancel();
              }}
            >
              <div role="dialog" aria-modal="true" className="w-full max-w-md">
                <ReviewCard review={review} busy={confirming} onConfirm={confirm} onCancel={cancel} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
