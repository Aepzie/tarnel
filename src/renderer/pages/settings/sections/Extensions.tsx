import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Check, ChevronRight, Flame, FolderOpen, Plus, Puzzle, RotateCw, Settings2, Store, Trash } from 'lucide-react';
import type {
  ExtensionInfo,
  ExtensionPatch,
  ExtensionReview,
  ExtensionSiteAccess,
  ExtensionSpaces,
  Space,
} from '@shared/types';
import { cn } from '@/lib/utils';
import { ease, rise, spring } from '@/lib/motion';
import { SPACE_HEX, velaPages } from '@/lib/vela';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cardClass, cardMotion, ExtensionIcon, HighRiskBadge, PermissionList, ReviewCard } from '@/components/extensions';
import { ConfirmActions } from '../components/confirm';
import { Row, SectionHeader } from '../components/layout';
import { errorText, hasBridge, useSettings } from '../store';

function InlineError({ message }: { message: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto', transition: { duration: 0.18, ease: ease.out } }}
          exit={{ opacity: 0, height: 0, transition: { duration: 0.14, ease: ease.out } }}
          className="overflow-hidden"
        >
          <span className="flex items-center gap-1 pt-2 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {message}
          </span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}

const chip =
  'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset outline-none transition-[background-color,color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:pointer-events-none';

const SITE_ACCESS: { value: ExtensionSiteAccess; label: string }[] = [
  { value: 'all', label: 'On all sites' },
  { value: 'sites', label: 'On specific sites' },
  { value: 'click', label: 'On click' },
];

function siteAccessHelp(extension: ExtensionInfo): string {
  if (extension.siteAccess === 'click') {
    return extension.armed
      ? 'Running until Vela restarts. Reload a page to let it act there.'
      : 'Stays off until you click its toolbar button (once per launch).';
  }
  if (extension.siteAccess === 'sites') {
    return 'Saved for these sites. Its content scripts still follow the manifest, so use On click or Spaces for a hard limit.';
  }
  return 'Runs everywhere its manifest allows.';
}

function SitesEditor({ sites, onSave }: { sites: string[]; onSave: (next: string[]) => void }) {
  const [text, setText] = useState(sites.join(', '));
  useEffect(() => setText(sites.join(', ')), [sites]);
  const commit = (): void => {
    const next = text.split(/[\s,]+/).filter(Boolean);
    if (next.join(',') !== sites.join(',')) onSave(next);
  };
  return (
    <Input
      value={text}
      spellCheck={false}
      aria-label="Sites"
      placeholder="example.com, github.com"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
      className="h-8 w-72 rounded-lg font-mono text-xs md:text-xs"
    />
  );
}

function SiteAccessPicker({ extension, onSave }: { extension: ExtensionInfo; onSave: (patch: ExtensionPatch) => void }) {
  return (
    <div className="flex flex-col items-end gap-2">
      <div role="radiogroup" aria-label="Site access" className="flex flex-wrap justify-end gap-1.5">
        {SITE_ACCESS.map((option) => {
          const on = extension.siteAccess === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!extension.enabled}
              onClick={() => onSave({ siteAccess: option.value })}
              className={cn(
                chip,
                on ? 'bg-accent text-foreground ring-border' : 'text-muted-foreground ring-border/60 hover:bg-accent hover:text-foreground',
                !extension.enabled && 'opacity-50',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {extension.siteAccess === 'sites' && <SitesEditor sites={extension.sites} onSave={(sites) => onSave({ sites })} />}
    </div>
  );
}

/** Space chips: "All" follows every regular Space (including new ones); Burners can't run extensions. */
function SpacePicker({
  value,
  spaces,
  disabled,
  onChange,
}: {
  value: ExtensionSpaces;
  spaces: Space[];
  disabled: boolean;
  onChange: (next: ExtensionSpaces) => void;
}) {
  const regular = spaces.filter((space) => !space.ephemeral);
  const isOn = (space: Space): boolean => !space.ephemeral && (value === 'all' || value.includes(space.id));

  const toggle = (space: Space): void => {
    const current = value === 'all' ? regular.map((s) => s.id) : value;
    const next = current.includes(space.id) ? current.filter((id) => id !== space.id) : [...current, space.id];
    onChange(next.length === regular.length ? 'all' : next);
  };

  return (
    <div role="group" aria-label="Spaces" className="flex max-w-80 flex-wrap justify-end gap-1.5">
      <button
        type="button"
        aria-pressed={value === 'all'}
        disabled={disabled}
        onClick={() => onChange('all')}
        className={cn(
          chip,
          value === 'all' ? 'bg-space/15 text-foreground ring-space/40' : 'text-muted-foreground ring-border hover:bg-accent hover:text-foreground',
          disabled && 'opacity-50',
        )}
      >
        All
      </button>
      {spaces.map((space) => {
        const on = isOn(space);
        const hex = SPACE_HEX[space.color];
        return (
          <button
            key={space.id}
            type="button"
            aria-pressed={on}
            disabled={disabled || space.ephemeral}
            title={space.ephemeral ? 'Burner Spaces can’t run extensions' : undefined}
            onClick={() => toggle(space)}
            className={cn(
              chip,
              on ? 'bg-accent text-foreground ring-border' : 'text-muted-foreground ring-border/60 hover:bg-accent hover:text-foreground',
              (disabled || space.ephemeral) && 'opacity-45',
            )}
          >
            {space.ephemeral ? (
              <Flame className="size-3 text-orange-500" strokeWidth={2} aria-hidden />
            ) : (
              <span
                aria-hidden
                className="size-2 rounded-full transition-[box-shadow,opacity] duration-150"
                style={{ backgroundColor: hex, boxShadow: on ? `0 0 0 2px ${hex}33` : 'none', opacity: on ? 1 : 0.5 }}
              />
            )}
            <span className="max-w-28 truncate">{space.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function ExtensionCard({
  extension,
  spaces,
  onChanged,
  onRemoved,
}: {
  extension: ExtensionInfo;
  spaces: Space[];
  onChanged: (next: ExtensionInfo) => void;
  onRemoved: (id: string) => void;
}) {
  const { markSaved } = useSettings();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [reloaded, setReloaded] = useState(false);

  useEffect(() => {
    if (!reloaded) return;
    const timer = window.setTimeout(() => setReloaded(false), 1400);
    return () => window.clearTimeout(timer);
  }, [reloaded]);

  const save = (patch: ExtensionPatch): void => {
    onChanged({ ...extension, ...patch });
    velaPages()
      .extensions.update(extension.id, patch)
      .then(
        (next) => {
          onChanged(next);
          setError(null);
          markSaved();
        },
        (failure) => {
          onChanged(extension);
          setError(errorText(failure, 'Could not save'));
        },
      );
  };

  const reload = (): void => {
    velaPages()
      .extensions.reload(extension.id)
      .then(
        (next) => {
          onChanged(next);
          setError(null);
          setReloaded(true);
        },
        (failure) => setError(errorText(failure, 'Could not reload')),
      );
  };

  const openOptions = (): void => {
    velaPages()
      .extensions.openOptions(extension.id)
      .catch((failure) => setError(errorText(failure, 'Could not open options')));
  };

  const loadProblem = extension.error ?? error;
  const ghost = 'h-8 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.96]';

  return (
    <motion.article layout="position" {...cardMotion} className={cardClass} aria-label={extension.name}>
      <header className="flex items-center gap-3 px-4 py-3">
        <ExtensionIcon extension={extension} muted={!extension.enabled} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] leading-6 font-semibold tracking-tight">{extension.name}</h2>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{extension.version}</span>
            {extension.source === 'unpacked' && (
              <Badge variant="outline" className="shrink-0 text-[10.5px] text-muted-foreground">
                Unpacked
              </Badge>
            )}
            <HighRiskBadge risk={extension.risk} />
          </div>
          {extension.description && (
            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{extension.description}</p>
          )}
        </div>
        <Switch
          id={`${id}-enabled`}
          aria-label={`Enable ${extension.name}`}
          checked={extension.enabled}
          onCheckedChange={(enabled) => save({ enabled })}
        />
      </header>

      <AnimatePresence initial={false}>
        {loadProblem && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto', transition: { duration: 0.18, ease: ease.out } }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.14, ease: ease.out } }}
            className="overflow-hidden"
          >
            <p className="mx-4 mb-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs leading-5 text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {loadProblem}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="divide-y divide-border border-t border-border">
        <Row title="Spaces" description="Where it runs. Burner Spaces never run extensions." className="items-start">
          <SpacePicker
            value={extension.spaces}
            spaces={spaces}
            disabled={!extension.enabled}
            onChange={(next) => save({ spaces: next })}
          />
        </Row>
        <Row title="Site access" description={siteAccessHelp(extension)} className="items-start">
          <SiteAccessPicker extension={extension} onSave={save} />
        </Row>
        <div className="px-4 py-3">
          <p className="mb-1.5 text-[13px] leading-5 font-medium">Permissions</p>
          <PermissionList permissions={extension.permissions} />
        </div>
        <Row title="Pin to toolbar" description="Show its button in the top island." htmlFor={`${id}-pinned`}>
          <Switch id={`${id}-pinned`} checked={extension.pinned} onCheckedChange={(pinned) => save({ pinned })} />
        </Row>
      </div>

      <footer className="flex items-center gap-1 border-t border-border bg-muted/40 px-2 py-2">
        {extension.hasOptions && (
          <Button type="button" variant="ghost" size="sm" onClick={openOptions} disabled={!extension.enabled} className={ghost}>
            <Settings2 className="size-3.5" strokeWidth={1.75} aria-hidden />
            Options
          </Button>
        )}
        {extension.source === 'unpacked' && (
          <Button type="button" variant="ghost" size="sm" onClick={reload} className={ghost}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={reloaded ? 'done' : 'idle'}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={spring.pop}
                className="grid place-items-center"
              >
                {reloaded ? (
                  <Check className="size-3.5 text-space" strokeWidth={2.25} aria-hidden />
                ) : (
                  <RotateCw className="size-3.5" strokeWidth={1.75} aria-hidden />
                )}
              </motion.span>
            </AnimatePresence>
            Reload
          </Button>
        )}
        <ConfirmActions
          className="ml-auto"
          actions={[
            {
              id: 'remove',
              label: 'Remove',
              icon: Trash,
              danger: true,
              message: `Remove “${extension.name}”?`,
              confirmLabel: 'Remove',
              run: async () => {
                await velaPages().extensions.remove(extension.id);
                onRemoved(extension.id);
              },
            },
          ]}
        />
      </footer>
    </motion.article>
  );
}

function InstallCard({ onInstalled }: { onInstalled: (extension: ExtensionInfo) => void }) {
  const { markSaved } = useSettings();
  const id = useId();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'store' | 'unpacked' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ExtensionReview | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const value = input.trim();
    if (!value || busy || !hasBridge()) return;
    setBusy('store');
    setError(null);
    try {
      setReview(await velaPages().extensions.install(value));
      setInput('');
    } catch (failure) {
      setError(errorText(failure, 'Could not add the extension'));
    } finally {
      setBusy(null);
    }
  };

  const loadUnpacked = async (): Promise<void> => {
    if (busy || !hasBridge()) return;
    setBusy('unpacked');
    setError(null);
    try {
      const loaded = await velaPages().extensions.loadUnpacked();
      if (loaded) setReview(loaded);
    } catch (failure) {
      setError(errorText(failure, 'Could not load the folder'));
    } finally {
      setBusy(null);
    }
  };

  const confirm = async (): Promise<void> => {
    if (!review || busy) return;
    setBusy('confirm');
    setError(null);
    try {
      onInstalled(await velaPages().extensions.confirmInstall(review.token));
      markSaved();
      setReview(null);
    } catch (failure) {
      setError(errorText(failure, 'Could not add the extension'));
      setReview(null);
    } finally {
      setBusy(null);
    }
  };

  const cancel = (): void => {
    if (!review) return;
    void velaPages().extensions.cancelInstall(review.token).catch(() => undefined);
    setReview(null);
  };

  if (review) return <ReviewCard review={review} busy={busy === 'confirm'} onConfirm={() => void confirm()} onCancel={cancel} />;

  return (
    <motion.form variants={rise} onSubmit={(event) => void submit(event)} autoComplete="off" className={cn(cardClass, 'mb-6')}>
      <div className="px-4 pt-4 pb-3">
        <label htmlFor={`${id}-input`} className="block text-[13px] leading-5 font-medium">
          Add from Chrome Web Store
        </label>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Paste the extension’s store link or its 32-letter ID.</p>
        <div className="mt-3 flex items-center gap-2">
          <Input
            id={`${id}-input`}
            value={input}
            spellCheck={false}
            placeholder="https://chromewebstore.google.com/detail/…"
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setInput(event.target.value);
              setError(null);
            }}
            className="h-8 flex-1 rounded-lg font-mono text-xs md:text-xs"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!input.trim() || busy !== null || !hasBridge()}
            className="h-8 gap-1.5 rounded-lg px-3 text-xs active:scale-[0.96]"
          >
            {busy === 'store' ? (
              <RotateCw className="size-3.5 motion-safe:animate-spin" strokeWidth={2} aria-hidden />
            ) : (
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            )}
            {busy === 'store' ? 'Adding…' : 'Add'}
          </Button>
        </div>
        <InlineError message={error} />
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 py-2 pr-2 pl-4">
        <span className="text-xs text-muted-foreground">Developing an extension?</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy !== null || !hasBridge()}
          onClick={() => void loadUnpacked()}
          className="h-8 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.96]"
        >
          <FolderOpen className="size-3.5" strokeWidth={1.75} aria-hidden />
          {busy === 'unpacked' ? 'Loading…' : 'Load unpacked…'}
        </Button>
      </footer>
    </motion.form>
  );
}

export function Extensions() {
  const [extensions, setExtensions] = useState<ExtensionInfo[] | null>(hasBridge() ? null : []);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!hasBridge()) return;
    Promise.all([velaPages().extensions.list(), velaPages().listSpaces()]).then(
      ([list, allSpaces]) => {
        setExtensions(list);
        setSpaces(allSpaces);
        setLoadError(null);
      },
      (error) => setLoadError(errorText(error, 'Could not load extensions')),
    );
  }, []);

  useEffect(refresh, [refresh]);

  const upsert = useCallback((next: ExtensionInfo) => {
    setExtensions((list) => {
      const current = list ?? [];
      return current.some((entry) => entry.id === next.id)
        ? current.map((entry) => (entry.id === next.id ? next : entry))
        : [...current, next];
    });
  }, []);

  const remove = useCallback((id: string) => setExtensions((list) => list?.filter((entry) => entry.id !== id) ?? list), []);

  return (
    <>
      <SectionHeader title="Extensions" description="Chrome extensions, scoped to the Spaces you choose." />

      <motion.button
        type="button"
        variants={rise}
        onClick={() => void velaPages().navigate('vela://extensions/')}
        disabled={!hasBridge()}
        className={cn(
          cardClass,
          'mb-3 flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-muted ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]">
          <Store className="size-4 text-space" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-5 font-medium">Browse extensions</span>
          <span className="block text-xs leading-5 text-muted-foreground">Vela’s picks for privacy, passwords and productivity.</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      </motion.button>

      <InstallCard onInstalled={upsert} />

      {loadError && (
        <p role="alert" className="mb-3 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5" strokeWidth={1.75} aria-hidden />
          {loadError}
        </p>
      )}

      <motion.div variants={rise} className="flex flex-col gap-3">
        {extensions === null ? (
          <div className={cn(cardClass, 'h-[184px] motion-safe:animate-pulse')} aria-hidden />
        ) : extensions.length === 0 ? (
          <div className={cn(cardClass, 'flex flex-col items-center gap-2 px-6 py-10 text-center')}>
            <span className="grid size-10 place-items-center rounded-xl bg-muted ring-1 ring-border">
              <Puzzle className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
            </span>
            <p className="text-[13px] font-medium">No extensions yet</p>
            <p className="max-w-72 text-xs leading-5 text-muted-foreground">
              Nothing extra runs until you add one. Extensions load only into the Spaces you pick.
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            {extensions.map((extension) => (
              <ExtensionCard key={extension.id} extension={extension} spaces={spaces} onChanged={upsert} onRemoved={remove} />
            ))}
          </AnimatePresence>
        )}
      </motion.div>

      <motion.p variants={rise} className="mt-6 px-1 text-xs leading-5 text-muted-foreground">
        Vela’s built-in blocker keeps running alongside extensions. Some Chrome APIs (such as blocking webRequest) aren’t
        available, so a few extensions may only partly work.
      </motion.p>
    </>
  );
}
