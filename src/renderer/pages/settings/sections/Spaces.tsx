import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Eraser, Fingerprint, Flame, Plus, RotateCw, ShieldCheck, Trash } from 'lucide-react';
import type { FingerprintLevel, Space, SpaceColor, SpaceInput } from '@shared/types';
import { cn } from '@/lib/utils';
import { ease, rise, spring } from '@/lib/motion';
import { SPACE_HEX, velaPages } from '@/lib/vela';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { LANGUAGE_OPTIONS, RegionSelect, TIMEZONE_HINT, TIMEZONE_OPTIONS } from '@/chrome/spaces/FingerprintPicker';
import { ConfirmActions } from '../components/confirm';
import { Segmented, Swatches, type SegmentOption } from '../components/controls';
import { Row, SectionHeader } from '../components/layout';
import { errorText, hasBridge, useSettings } from '../store';

const PROXY_PLACEHOLDER = 'socks5://127.0.0.1:9050';

const FINGERPRINT_OPTIONS: readonly SegmentOption<FingerprintLevel>[] = [
  { value: 'off', label: 'Off' },
  { value: 'standard', label: 'Standard' },
  { value: 'strict', label: 'Strict' },
];

const FINGERPRINT_HINTS: Record<FingerprintLevel, string> = {
  off: 'Sites see this device’s real fingerprint.',
  standard: 'Subtle per-site noise on canvas, WebGL and audio; generalized hardware.',
  strict: 'Also masks screen size, media devices and client hints. May break a few sites.',
};

const cardMotion = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: spring.soft },
  exit: { opacity: 0, scale: 0.97, filter: 'blur(4px)', transition: { duration: 0.16, ease: ease.out } },
};

const cardClass =
  'overflow-hidden rounded-xl bg-card/50 ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]';

function FieldError({ id, message }: { id: string; message: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          id={id}
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto', transition: { duration: 0.18, ease: ease.out } }}
          exit={{ opacity: 0, height: 0, transition: { duration: 0.14, ease: ease.out } }}
          className="overflow-hidden"
        >
          <span className="flex items-center gap-1 pt-1.5 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {message}
          </span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}

const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>, revert: () => void) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    revert();
    requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
  }
};

function SpaceCard({
  space,
  canDelete,
  onUpdated,
  onRemoved,
}: {
  space: Space;
  canDelete: boolean;
  onUpdated: (space: Space) => void;
  onRemoved: (id: string) => void;
}) {
  const { markSaved } = useSettings();
  const id = useId();
  const [name, setName] = useState(space.name);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [color, setColor] = useState<SpaceColor>(space.color);
  const [colorError, setColorError] = useState<string | null>(null);
  const confirmedColor = useRef<SpaceColor>(space.color);
  const [proxy, setProxy] = useState(space.proxy);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<FingerprintLevel>(space.fingerprint);
  const [fingerprintError, setFingerprintError] = useState<string | null>(null);

  useEffect(() => setFingerprint(space.fingerprint), [space.fingerprint]);
  useEffect(() => {
    confirmedColor.current = space.color;
    setColor(space.color);
  }, [space.color]);
  useEffect(() => setName(space.name), [space.name]);

  const save = async (patch: Partial<SpaceInput>): Promise<Space> => {
    const next = await velaPages().updateSpace(space.id, patch);
    onUpdated(next);
    markSaved();
    return next;
  };

  const commitName = async () => {
    const value = name.trim();
    if (value === space.name) {
      setName(space.name);
      setNameInvalid(false);
      return;
    }
    if (!value) {
      setName(space.name);
      setNameInvalid(true);
      return;
    }
    try {
      setName((await save({ name: value })).name);
      setNameInvalid(false);
    } catch {
      setName(space.name);
      setNameInvalid(true);
    }
  };

  const commitProxy = async () => {
    const value = proxy.trim();
    if (value === space.proxy) {
      setProxy(space.proxy);
      return;
    }
    try {
      setProxy((await save({ proxy: value })).proxy);
      setProxyError(null);
    } catch (error) {
      setProxy(space.proxy);
      setProxyError(errorText(error, 'Invalid proxy. Use scheme://host:port'));
    }
  };

  const pickColor = (next: SpaceColor) => {
    setColor(next);
    setColorError(null);
    save({ color: next }).then(
      (saved) => {
        confirmedColor.current = saved.color;
      },
      (error) => {
        setColor(confirmedColor.current);
        setColorError(errorText(error, 'Could not change color'));
      },
    );
  };

  const pickFingerprint = (next: FingerprintLevel) => {
    setFingerprint(next);
    setFingerprintError(null);
    save({ fingerprint: next }).catch((error) => {
      setFingerprint(space.fingerprint);
      setFingerprintError(errorText(error, 'Could not change fingerprint protection'));
    });
  };

  const pickRegion = (patch: Pick<SpaceInput, 'timezone' | 'language'>) => {
    setFingerprintError(null);
    save(patch).catch((error) => setFingerprintError(errorText(error, 'Could not change this setting')));
  };

  const hex = SPACE_HEX[color];

  return (
    <motion.article layout="position" {...cardMotion} className={cardClass} aria-label={`${space.name} Space`}>
      <header className="flex h-14 items-center gap-3 px-4">
        <motion.span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          initial={false}
          animate={{ backgroundColor: hex, boxShadow: `0 0 0 3px ${hex}26, 0 0 12px ${hex}66` }}
          transition={{ duration: 0.24, ease: ease.out }}
        />
        <input
          value={name}
          maxLength={40}
          spellCheck={false}
          autoComplete="off"
          aria-label="Space name"
          aria-invalid={nameInvalid || undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameInvalid(false);
          }}
          onKeyDown={(event) => blurOnEnter(event, () => setName(space.name))}
          onBlur={() => {
            if (name === space.name) return;
            void commitName();
          }}
          className={cn(
            '-mx-1.5 h-8 min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 text-[15px] font-semibold tracking-tight text-foreground outline-none transition-[background-color,box-shadow] duration-150',
            'hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50',
            'aria-invalid:ring-2 aria-invalid:ring-destructive/40',
          )}
        />
        {space.ephemeral && (
          <Badge
            variant="outline"
            title="In memory only. Wiped when Vela closes."
            className="gap-1 border-orange-500/25 bg-orange-500/10 text-orange-600 dark:text-orange-300"
          >
            <Flame strokeWidth={2} aria-hidden />
            Burner
          </Badge>
        )}
      </header>

      <div className="divide-y divide-border border-t border-border">
        <Row title="Color" className="items-start">
          <div className="flex flex-col items-end">
            <Swatches label={`Color for ${space.name}`} value={color} onChange={pickColor} />
            <FieldError id={`${id}-color-error`} message={colorError} />
          </div>
        </Row>
        <Row
          title="Proxy"
          description="Route only this Space through a proxy. Empty means direct."
          htmlFor={`${id}-proxy`}
          className="items-start"
        >
          <div className="w-60">
            <Input
              id={`${id}-proxy`}
              value={proxy}
              placeholder={PROXY_PLACEHOLDER}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={proxyError ? true : undefined}
              aria-describedby={proxyError ? `${id}-proxy-error` : undefined}
              onChange={(event) => {
                setProxy(event.target.value);
                setProxyError(null);
              }}
              onKeyDown={(event) => blurOnEnter(event, () => setProxy(space.proxy))}
              onBlur={() => void commitProxy()}
              className="h-8 rounded-lg font-mono text-xs md:text-xs"
            />
            <FieldError id={`${id}-proxy-error`} message={proxyError} />
          </div>
        </Row>
        <Row title="Fingerprint" description={FINGERPRINT_HINTS[fingerprint]} className="items-start">
          <div className="flex flex-col items-end">
            <Segmented label={`Fingerprint protection for ${space.name}`} value={fingerprint} options={FINGERPRINT_OPTIONS} onChange={pickFingerprint} />
            <FieldError id={`${id}-fingerprint-error`} message={fingerprintError} />
          </div>
        </Row>
        <Row title="Timezone" description={TIMEZONE_HINT}>
          <RegionSelect
            label={`Timezone for ${space.name}`}
            value={space.timezone ?? ''}
            options={TIMEZONE_OPTIONS}
            disabled={fingerprint === 'off'}
            onChange={(timezone) => pickRegion({ timezone })}
            className="w-44"
          />
        </Row>
        <Row title="Language" description="navigator.languages, Intl and Accept-Language for this Space.">
          <RegionSelect
            label={`Language for ${space.name}`}
            value={space.language ?? ''}
            options={LANGUAGE_OPTIONS}
            disabled={fingerprint === 'off'}
            onChange={(language) => pickRegion({ language })}
            className="w-44"
          />
        </Row>
      </div>

      <footer className="flex items-center border-t border-border bg-muted/40 px-2 py-2">
        <ConfirmActions
          className="w-full"
          actions={[
            {
              id: 'fingerprint',
              label: 'New fingerprint',
              icon: Fingerprint,
              disabled: fingerprint === 'off',
              disabledReason: 'Fingerprint protection is off',
              message: 'Show every site a new fingerprint?',
              confirmLabel: 'Regenerate',
              successLabel: 'New fingerprint on next load',
              run: () => velaPages().regenerateFingerprint(space.id),
            },
            {
              id: 'clear',
              label: 'Clear data',
              icon: Eraser,
              message: 'Clear cookies, storage and cache?',
              confirmLabel: 'Clear data',
              successLabel: 'Data cleared',
              danger: true,
              run: () => velaPages().clearSpaceData(space.id),
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: Trash,
              danger: true,
              disabled: !canDelete,
              disabledReason: 'At least one Space is required',
              message: `Delete “${space.name}” and all its data?`,
              confirmLabel: 'Delete Space',
              run: async () => {
                await velaPages().removeSpace(space.id);
                onRemoved(space.id);
              },
            },
          ]}
        />
      </footer>
    </motion.article>
  );
}

function NewSpaceCard({ onCreated }: { onCreated: (space: Space) => void }) {
  const { markSaved } = useSettings();
  const id = useId();
  const [name, setName] = useState('');
  const [color, setColor] = useState<SpaceColor>('violet');
  const [ephemeral, setEphemeral] = useState(false);
  const [proxy, setProxy] = useState('');
  const [fingerprint, setFingerprint] = useState<FingerprintLevel>('standard');
  /** Until the user picks a level, Burner implies Strict. */
  const fingerprintTouched = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || busy || !hasBridge()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await velaPages().createSpace({ name: value, color, ephemeral, proxy: proxy.trim(), fingerprint });
      onCreated(created);
      markSaved();
      setName('');
      setProxy('');
      setEphemeral(false);
      setFingerprint('standard');
      fingerprintTouched.current = false;
    } catch (failure) {
      setError(errorText(failure, 'Could not create Space'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.form
      layout="position"
      variants={rise}
      onSubmit={(event) => void submit(event)}
      autoComplete="off"
      aria-labelledby={`${id}-title`}
      className={cn(cardClass, 'mt-3')}
    >
      <header className="flex h-14 items-center gap-3 px-4">
        <span className="grid size-6 place-items-center rounded-full bg-muted ring-1 ring-border" aria-hidden>
          <Plus className="size-3.5 text-muted-foreground" strokeWidth={2} />
        </span>
        <h2 id={`${id}-title`} className="text-[15px] font-semibold tracking-tight">
          New Space
        </h2>
      </header>
      <div className="divide-y divide-border border-t border-border">
        <Row title="Name" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={40}
            spellCheck={false}
            placeholder="Work, Research, Shopping…"
            onChange={(event) => setName(event.target.value)}
            className="h-8 w-60 rounded-lg text-xs md:text-xs"
          />
        </Row>
        <Row title="Color">
          <Swatches label="New Space color" value={color} onChange={setColor} />
        </Row>
        <Row title="Proxy" description="Optional." htmlFor={`${id}-proxy`}>
          <Input
            id={`${id}-proxy`}
            value={proxy}
            spellCheck={false}
            placeholder={PROXY_PLACEHOLDER}
            onChange={(event) => setProxy(event.target.value)}
            className="h-8 w-60 rounded-lg font-mono text-xs md:text-xs"
          />
        </Row>
        <Row
          title={
            <span className="flex items-center gap-1.5">
              <Flame className="size-3.5 text-orange-500" strokeWidth={1.75} aria-hidden />
              Burner
            </span>
          }
          description="In memory only. Everything is wiped when Vela closes."
          htmlFor={`${id}-burner`}
          descriptionId={`${id}-burner-desc`}
        >
          <Switch
            id={`${id}-burner`}
            aria-describedby={`${id}-burner-desc`}
            checked={ephemeral}
            onCheckedChange={(burner) => {
              setEphemeral(burner);
              if (!fingerprintTouched.current) setFingerprint(burner ? 'strict' : 'standard');
            }}
          />
        </Row>
        <Row title="Fingerprint" description={FINGERPRINT_HINTS[fingerprint]}>
          <Segmented
            label="New Space fingerprint protection"
            value={fingerprint}
            options={FINGERPRINT_OPTIONS}
            onChange={(level) => {
              fingerprintTouched.current = true;
              setFingerprint(level);
            }}
          />
        </Row>
      </div>
      <footer className="flex items-center justify-end gap-3 border-t border-border bg-muted/40 px-2 py-2">
        <AnimatePresence initial={false}>
          {error && (
            <motion.span
              key={error}
              role="alert"
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="mr-auto flex items-center gap-1 px-2 text-xs text-destructive"
            >
              <AlertCircle className="size-3.5" strokeWidth={1.75} aria-hidden />
              {error}
            </motion.span>
          )}
        </AnimatePresence>
        <Button
          type="submit"
          size="sm"
          disabled={!name.trim() || busy || !hasBridge()}
          className="h-8 gap-1.5 rounded-lg px-3 text-xs active:scale-[0.96]"
        >
          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
          {busy ? 'Creating…' : 'Create Space'}
        </Button>
      </footer>
    </motion.form>
  );
}

export function Spaces() {
  const [spaces, setSpaces] = useState<Space[] | null>(hasBridge() ? null : []);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!hasBridge()) return;
    velaPages()
      .listSpaces()
      .then(
        (list) => {
          setSpaces(list);
          setLoadError(null);
        },
        (error) => setLoadError(errorText(error, 'Could not load Spaces')),
      );
  }, []);

  useEffect(refresh, [refresh]);

  const replace = useCallback(
    (next: Space) => setSpaces((list) => list?.map((space) => (space.id === next.id ? next : space)) ?? list),
    [],
  );
  const remove = useCallback((id: string) => {
    setSpaces((list) => list?.filter((space) => space.id !== id) ?? list);
    refresh();
  }, [refresh]);
  const add = useCallback((space: Space) => {
    setSpaces((list) => (list ? [...list, space] : [space]));
    refresh();
  }, [refresh]);

  return (
    <>
      <SectionHeader
        title="Spaces"
        description="Each Space is a sealed sandbox. Cookies, logins, cache and storage never cross over."
      />

      <motion.div
        variants={rise}
        className="mb-6 flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 text-xs leading-5 text-muted-foreground ring-1 ring-border"
      >
        <ShieldCheck className="size-4 shrink-0 text-space" strokeWidth={1.75} aria-hidden />
        <p>
          Sign into the same site twice, keep work and personal apart, or open a{' '}
          <span className="font-medium text-foreground">Burner</span> that forgets everything on close.
        </p>
      </motion.div>

      {loadError && spaces !== null && (
        <p role="alert" className="mb-3 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5" strokeWidth={1.75} aria-hidden />
          {loadError}
        </p>
      )}

      <motion.div variants={rise} className="flex flex-col gap-3">
        {spaces === null && loadError ? (
          <div role="alert" className={cn(cardClass, 'flex h-14 items-center gap-3 px-4')}>
            <AlertCircle className="size-4 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden />
            <span className="flex-1 text-xs text-muted-foreground">{loadError}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={refresh}
              className="h-8 gap-1.5 rounded-lg px-2.5 text-xs active:scale-[0.96]"
            >
              <RotateCw className="size-3.5" strokeWidth={1.75} aria-hidden />
              Retry
            </Button>
          </div>
        ) : spaces === null ? (
          <div className={cn(cardClass, 'h-[216px] motion-safe:animate-pulse')} aria-hidden />
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            {spaces.map((space) => (
              <SpaceCard
                key={space.id}
                space={space}
                canDelete={spaces.length > 1}
                onUpdated={replace}
                onRemoved={remove}
              />
            ))}
          </AnimatePresence>
        )}
      </motion.div>

      <NewSpaceCard onCreated={add} />
    </>
  );
}
