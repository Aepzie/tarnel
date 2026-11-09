import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Folder,
  FolderOpen,
  KeyRound,
  Laptop,
  LogOut,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { DEFAULT_SYNC_CATEGORIES, type SyncCategories, type SyncStatus, type SyncTransportInput } from '@shared/types';
import { cn } from '@/lib/utils';
import { ease, spring } from '@/lib/motion';
import { velaPages } from '@/lib/vela';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmActions } from '../components/confirm';
import { Segmented } from '../components/controls';
import { Group, Row, SectionHeader } from '../components/layout';
import { errorText, hasBridge } from '../store';

const CATEGORY_ROWS: { key: keyof SyncCategories; title: string; description: string }[] = [
  { key: 'settings', title: 'Settings', description: 'Search engine, theme, privacy and performance options. Window look stays per device.' },
  { key: 'spaces', title: 'Spaces', description: 'Names, colors and proxies. Cookies, logins and site data never leave this device.' },
  { key: 'tabs', title: 'Open tabs', description: 'Find tabs from your other devices in the command palette.' },
  { key: 'history', title: 'History', description: 'Visited pages and top sites.' },
];

const swap = {
  initial: { opacity: 0, x: 8, filter: 'blur(3px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.2, ease: ease.out } },
  exit: { opacity: 0, x: -8, filter: 'blur(3px)', transition: { duration: 0.12, ease: ease.out } },
};

/** Section-level crossfade that still propagates the 'show' variant to Group / Row entrances. */
const sectionSwap = {
  hidden: { opacity: 0, y: 6, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.22, ease: ease.out, staggerChildren: 0.04 } },
  exit: { opacity: 0, y: -4, filter: 'blur(2px)', transition: { duration: 0.12, ease: ease.out } },
};

function timeAgo(at: number | null, now: number): string {
  if (!at) return 'Never';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString();
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Polls main while the section is open (fast while a sync runs). */
function useSyncStatus(): [SyncStatus | null, (next: SyncStatus) => void] {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const syncing = status?.syncing ?? false;
  useEffect(() => {
    if (!hasBridge()) return;
    let alive = true;
    const load = () =>
      velaPages()
        .sync.status()
        .then((next) => alive && setStatus(next), () => undefined);
    load();
    const timer = window.setInterval(load, syncing ? 800 : 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [syncing]);
  return [status, setStatus];
}

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
          <span className="flex items-center gap-1.5 pt-2 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {message}
          </span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <label htmlFor={htmlFor} className="text-[13px] leading-5 font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass = 'h-8 w-72 rounded-lg text-xs md:text-xs';
const primaryButton = 'h-8 gap-1.5 rounded-lg px-3 text-xs active:scale-[0.96]';
const ghostButton = 'h-8 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.96]';

function RecoveryKey({ value, onDismiss }: { value: string; onDismiss?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }, () => undefined);
  };
  return (
    <div className="px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-space/15 text-space ring-1 ring-border">
          <KeyRound className="size-3.5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-5 font-medium text-foreground">Recovery key</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Store it somewhere safe. It joins a new device without the passphrase — and nobody, including Vela, can recover your data without one of them.
          </p>
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 font-mono text-[12px] leading-5 tracking-wide break-all text-foreground ring-1 ring-border select-all">
            {value}
          </p>
          <div className="mt-2 flex items-center justify-end gap-1">
            {onDismiss && (
              <Button type="button" variant="ghost" size="sm" onClick={onDismiss} className={ghostButton}>
                Done
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={copy} className={primaryButton}>
              {copied ? <Check className="size-3.5 text-space" strokeWidth={2} aria-hidden /> : <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// setup wizard: where → passphrase → what

type Step = 'where' | 'secret' | 'what';

function SetupWizard({ onCancel, onEnabled }: { onCancel: () => void; onEnabled: (status: SyncStatus, created: boolean) => void }) {
  const id = useId();
  const [step, setStep] = useState<Step>('where');
  const [kind, setKind] = useState<'folder' | 'webdav'>('folder');
  const [folder, setFolder] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [categories, setCategories] = useState<SyncCategories>({ ...DEFAULT_SYNC_CATEGORIES });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transport = (): SyncTransportInput =>
    kind === 'folder' ? { kind, path: folder } : { kind, url: url.trim(), username: username.trim(), password };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorText(err, 'Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = () =>
    void run(async () => {
      const picked = await velaPages().sync.pickFolder();
      if (picked) setFolder(picked);
    });

  const submitWhere = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { exists } = await velaPages().sync.probe(transport());
      setMode(exists ? 'join' : 'create');
      setStep('secret');
    });
  };

  const submitSecret = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'create' && secret.length < 8) return setError('Use at least 8 characters — a few random words work well');
    if (mode === 'create' && secret !== confirm) return setError('The passphrases don’t match');
    setError(null);
    setStep('what');
  };

  const enable = () =>
    void run(async () => {
      const status = await velaPages().sync.enable({ transport: transport(), mode, secret, categories });
      onEnabled(status, mode === 'create');
    });

  const whereReady = kind === 'folder' ? !!folder : !!url.trim() && !!username.trim() && !!password;
  const back = (to: Step) => () => {
    setError(null);
    setStep(to);
  };

  return (
    <motion.section layout transition={spring.soft} className="mb-8 overflow-hidden rounded-xl bg-card/50 ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        {(['where', 'secret', 'what'] as const).map((name, index) => (
          <span key={name} className="flex items-center gap-2 text-xs">
            {index > 0 && <span className="h-px w-4 bg-border" aria-hidden />}
            <span className={cn('transition-colors duration-150', step === name ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {['Storage', 'Passphrase', 'What to sync'][index]}
            </span>
          </span>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {step === 'where' && (
          <motion.form key="where" {...swap} onSubmit={submitWhere} className="divide-y divide-border">
            <Row title="Store encrypted data in" description="A folder your cloud drive syncs, or a WebDAV server such as Nextcloud.">
              <Segmented
                label="Storage"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'folder', label: 'Folder', icon: Folder },
                  { value: 'webdav', label: 'WebDAV', icon: Server },
                ]}
              />
            </Row>
            {kind === 'folder' ? (
              <Row title="Folder" description={folder ? <span className="font-mono break-all">{folder}</span> : 'OneDrive, Dropbox, iCloud Drive, Syncthing…'}>
                <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={pickFolder} className={primaryButton}>
                  <FolderOpen className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {folder ? 'Change…' : 'Choose…'}
                </Button>
              </Row>
            ) : (
              <>
                <Field label="Server URL" htmlFor={`${id}-url`}>
                  <Input id={`${id}-url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cloud.example.com/remote.php/dav/files/me/" spellCheck={false} autoComplete="off" className={cn(inputClass, 'font-mono')} />
                </Field>
                <Field label="Username" htmlFor={`${id}-user`}>
                  <Input id={`${id}-user`} value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoComplete="off" className={inputClass} />
                </Field>
                <Field label="App password" htmlFor={`${id}-pass`}>
                  <Input id={`${id}-pass`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" className={inputClass} />
                </Field>
              </>
            )}
            <div className="px-4 py-3">
              <div className="flex items-center justify-end gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel} className={ghostButton}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={!whereReady || busy} className={primaryButton}>
                  {busy ? 'Checking…' : 'Continue'}
                </Button>
              </div>
              <InlineError message={error} />
            </div>
          </motion.form>
        )}

        {step === 'secret' && (
          <motion.form key="secret" {...swap} onSubmit={submitSecret} className="divide-y divide-border">
            <div className="px-4 py-3 text-xs leading-5 text-muted-foreground">
              {mode === 'join'
                ? 'This location already holds Vela sync data. Enter its passphrase or recovery key to join.'
                : 'Your passphrase encrypts everything before it leaves this device. Vela can’t reset it — you’ll get a recovery key next.'}
            </div>
            <Field label={mode === 'join' ? 'Passphrase or recovery key' : 'Passphrase'} htmlFor={`${id}-secret`}>
              <Input id={`${id}-secret`} type="password" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" className={inputClass} />
            </Field>
            {mode === 'create' && (
              <Field label="Repeat passphrase" htmlFor={`${id}-confirm`}>
                <Input id={`${id}-confirm`} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={inputClass} />
              </Field>
            )}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={back('where')} className={ghostButton}>
                  <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Back
                </Button>
                <Button type="submit" size="sm" disabled={!secret} className={primaryButton}>
                  Continue
                </Button>
              </div>
              <InlineError message={error} />
            </div>
          </motion.form>
        )}

        {step === 'what' && (
          <motion.div key="what" {...swap} className="divide-y divide-border">
            {CATEGORY_ROWS.map((row) => (
              <Row key={row.key} title={row.title} description={row.description} htmlFor={`${id}-${row.key}`}>
                <Switch id={`${id}-${row.key}`} checked={categories[row.key]} onCheckedChange={(checked) => setCategories((c) => ({ ...c, [row.key]: checked }))} />
              </Row>
            ))}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={back('secret')} className={ghostButton}>
                  <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Back
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={enable} className={primaryButton}>
                  <ShieldCheck className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {busy ? (mode === 'join' ? 'Unlocking…' : 'Encrypting…') : 'Turn on sync'}
                </Button>
              </div>
              <InlineError message={error} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// enabled: status, devices, categories, recovery, disconnect

function StatusDot({ status }: { status: SyncStatus }) {
  const tone = status.lastError ? 'bg-destructive' : status.syncing ? 'bg-space' : 'bg-emerald-500';
  return (
    <span className="relative grid size-2 place-items-center" aria-hidden>
      {status.syncing && <span className="absolute inset-0 rounded-full bg-space/60 motion-safe:animate-ping" />}
      <span className={cn('size-2 rounded-full transition-colors duration-200', tone)} />
    </span>
  );
}

function SyncOn({ status, onStatus, freshKey, onDismissKey }: { status: SyncStatus; onStatus: (s: SyncStatus) => void; freshKey: string | null; onDismissKey: () => void }) {
  const id = useId();
  const now = useNow(15_000);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncNow = () => {
    onStatus({ ...status, syncing: true });
    velaPages().sync.now().then(onStatus, (err) => setError(errorText(err, 'Sync failed')));
  };

  const toggle = (key: keyof SyncCategories, checked: boolean) => {
    const next = { ...status.categories, [key]: checked };
    onStatus({ ...status, categories: next });
    velaPages().sync.setCategories(next).then(onStatus, (err) => setError(errorText(err, 'Could not save')));
  };

  const reveal = () => {
    velaPages().sync.recoveryKey().then(setRevealed, (err) => setError(errorText(err, 'Could not read the key')));
  };

  return (
    <>
      <Group title="Status">
        <Row
          title={
            <span className="flex items-center gap-2">
              <StatusDot status={status} />
              {status.syncing ? 'Syncing…' : status.lastError ? 'Sync problem' : 'Up to date'}
            </span>
          }
          description={
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={status.lastError ?? 'ok'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: ease.out }} className={cn(status.lastError && 'text-destructive')}>
                {status.lastError ?? `Last synced ${timeAgo(status.lastSyncAt, now).toLowerCase()}`}
              </motion.span>
            </AnimatePresence>
          }
        >
          <Button type="button" variant="secondary" size="sm" disabled={status.syncing} onClick={syncNow} className={primaryButton}>
            <RefreshCw className={cn('size-3.5', status.syncing && 'motion-safe:animate-spin')} strokeWidth={1.75} aria-hidden />
            Sync now
          </Button>
        </Row>
        {status.transport && (
          <Row
            title={status.transport.kind === 'folder' ? 'Folder' : 'WebDAV'}
            description={<span className="font-mono break-all">{status.transport.label}</span>}
          >
            <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
              <ShieldCheck className="size-3 text-space" strokeWidth={2} aria-hidden />
              End-to-end encrypted
            </span>
          </Row>
        )}
      </Group>
      {error && (
        <div className="-mt-6 mb-6">
          <InlineError message={error} />
        </div>
      )}

      <Group title="Devices">
        {status.devices.map((device) => (
          <Row
            key={device.id}
            title={
              <span className="flex items-center gap-2">
                <Laptop className="size-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                {device.name}
                {device.current && <span className="rounded-full bg-space/15 px-1.5 py-px text-[10.5px] font-medium text-space">This device</span>}
              </span>
            }
            description={`Last active ${timeAgo(device.lastSeen, now).toLowerCase()}`}
          >
            <span />
          </Row>
        ))}
      </Group>

      <Group title="What to sync">
        {CATEGORY_ROWS.map((row) => (
          <Row key={row.key} title={row.title} description={row.description} htmlFor={`${id}-${row.key}`}>
            <Switch id={`${id}-${row.key}`} checked={status.categories[row.key]} onCheckedChange={(checked) => toggle(row.key, checked)} />
          </Row>
        ))}
      </Group>

      <Group title="Recovery">
        <AnimatePresence mode="wait" initial={false}>
          {freshKey || revealed ? (
            <motion.div key="key" {...swap}>
              <RecoveryKey
                value={(freshKey ?? revealed)!}
                onDismiss={() => {
                  onDismissKey();
                  setRevealed(null);
                }}
              />
            </motion.div>
          ) : (
            <motion.div key="row" {...swap}>
              <Row title="Recovery key" description="Joins a new device if you forget the passphrase.">
                <Button type="button" variant="ghost" size="sm" onClick={reveal} className={ghostButton}>
                  <KeyRound className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Show key
                </Button>
              </Row>
            </motion.div>
          )}
        </AnimatePresence>
      </Group>

      <Group title="Disconnect">
        <Row title="Stop syncing" description="Keeps everything on this device. Wiping also deletes the encrypted data for all devices.">
          <ConfirmActions
            actions={[
              {
                id: 'disconnect',
                label: 'Disconnect',
                icon: LogOut,
                message: 'Stop syncing this device?',
                confirmLabel: 'Disconnect',
                run: () => velaPages().sync.disconnect(false).then(onStatus),
              },
              {
                id: 'wipe',
                label: 'Wipe remote',
                icon: Trash2,
                danger: true,
                message: 'Delete synced data everywhere?',
                confirmLabel: 'Wipe & disconnect',
                run: () => velaPages().sync.disconnect(true).then(onStatus),
              },
            ]}
          />
        </Row>
      </Group>
    </>
  );
}

export function Sync() {
  const [status, setStatus] = useSyncStatus();
  const [setup, setSetup] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const onEnabled = useCallback(
    (next: SyncStatus, created: boolean) => {
      setStatus(next);
      setSetup(false);
      if (created) velaPages().sync.recoveryKey().then(setFreshKey, () => undefined);
    },
    [setStatus],
  );

  return (
    <>
      <SectionHeader title="Sync" description="Optional and end-to-end encrypted. Your data goes to storage you own — Vela runs no servers." />
      <AnimatePresence mode="wait" initial={false}>
        {status?.enabled ? (
          <motion.div key="on" variants={sectionSwap} initial="hidden" animate="show" exit="exit">
            <SyncOn status={status} onStatus={setStatus} freshKey={freshKey} onDismissKey={() => setFreshKey(null)} />
          </motion.div>
        ) : setup ? (
          <motion.div key="setup" variants={sectionSwap} initial="hidden" animate="show" exit="exit">
            <SetupWizard onCancel={() => setSetup(false)} onEnabled={onEnabled} />
          </motion.div>
        ) : (
          <motion.div key="off" variants={sectionSwap} initial="hidden" animate="show" exit="exit">
            <Group>
              <Row
                title="Sync is off"
                description={
                  status && !status.secureStorage
                    ? 'This system has no secure key storage, so sync is unavailable.'
                    : 'Settings, Spaces and open tabs follow you to your other devices, encrypted with a passphrase only you know.'
                }
              >
                <Button type="button" size="sm" disabled={!hasBridge() || (status !== null && !status.secureStorage)} onClick={() => setSetup(true)} className={primaryButton}>
                  <ShieldCheck className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Set up sync
                </Button>
              </Row>
            </Group>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
