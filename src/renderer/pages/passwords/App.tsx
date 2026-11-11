import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Copy, Download, Eye, EyeOff, KeyRound, Pencil, Puzzle, Search, Trash2, Upload, X } from 'lucide-react';
import type { PasswordsStatus, SavedLogin } from '@shared/passwords';
import type { ExtensionReview } from '@shared/types';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { settle, velaPages } from '@/lib/vela';

const REVEAL_MS = 30_000;
const MANAGERS = [
  { id: 'nngceckbapebfimnlniiiahkandclblb', name: 'Bitwarden' },
  { id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', name: '1Password' },
] as const;

const api = () => velaPages().passwords!;
const errorText = (error: unknown): string => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong.');

const button = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const quiet = cn(button, 'text-muted-foreground hover:bg-muted hover:text-foreground');
const solid = cn(button, 'bg-foreground text-background hover:opacity-90');
const icon = 'inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';

export function App() {
  const [status, setStatus] = useState<PasswordsStatus | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [logins, setLogins] = useState<SavedLogin[]>([]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmExport, setConfirmExport] = useState(false);

  useEffect(() => {
    document.title = 'Passwords';
    if (!velaPages()?.passwords) return;
    void Promise.all([api().status(), velaPages().currentSpace()]).then(([next, current]) => {
      setStatus(next);
      setSpaceId((current && next.spaces.some((space) => space.spaceId === current.id) ? current.id : next.spaces[0]?.spaceId) ?? null);
    });
  }, []);

  const refresh = useCallback(() => {
    if (!spaceId) return;
    void api().list(spaceId).then(setLogins);
    void api().status().then(setStatus);
  }, [spaceId]);

  useEffect(refresh, [refresh]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return logins;
    return logins.filter((login) => login.origin.toLowerCase().includes(needle) || login.username.toLowerCase().includes(needle));
  }, [logins, query]);

  const space = status?.spaces.find((candidate) => candidate.spaceId === spaceId);

  const run = (task: Promise<unknown>, done?: string): void => {
    task.then(() => done && setNotice(done)).catch((error) => setNotice(errorText(error))).finally(refresh);
  };

  const exportCsv = (): void => {
    if (!spaceId) return;
    setConfirmExport(false);
    api()
      .exportCsv(spaceId)
      .then((result) => result.saved && setNotice(`Exported ${result.count} passwords. Delete the file when you are done with it.`))
      .catch((error) => setNotice(errorText(error)));
  };

  if (!velaPages()?.passwords) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-[13px] text-foreground">
      <header className="mb-6 flex items-center gap-3">
        <KeyRound className="size-5 text-muted-foreground" strokeWidth={1.75} />
        <h1 className="text-xl font-semibold tracking-tight">Passwords</h1>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={quiet} onClick={() => settle(velaPages().navigate('vela://settings/#import'))}>
            <Upload className="size-3.5" strokeWidth={1.75} /> Import passwords…
          </button>
          <button type="button" className={quiet} disabled={logins.length === 0} onClick={() => setConfirmExport(true)}>
            <Download className="size-3.5" strokeWidth={1.75} /> Export CSV
          </button>
        </div>
      </header>

      {status && !status.encryption && (
        <Banner tone="warn">OS encryption is not available, so Vela will not save passwords. On Linux, install and unlock a keyring (GNOME Keyring or KWallet).</Banner>
      )}
      {confirmExport && (
        <Banner tone="warn">
          The CSV file holds every password of this Space in plain text. Anyone who can open the file can read them.
          <span className="mt-2 flex gap-2">
            <button type="button" className={solid} onClick={exportCsv}>Export anyway</button>
            <button type="button" className={quiet} onClick={() => setConfirmExport(false)}>Cancel</button>
          </span>
        </Banner>
      )}
      {notice && (
        <Banner tone="info" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      <div className="mb-4 flex items-center gap-2">
        {status && status.spaces.length > 1 && (
          <Select value={spaceId ?? undefined} onValueChange={setSpaceId}>
            <SelectTrigger aria-label="Space" className="h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start" sideOffset={6} className="rounded-xl p-0.5 backdrop-blur-xl">
              {status.spaces.map((candidate) => (
                <SelectItem key={candidate.spaceId} value={candidate.spaceId} className="rounded-lg text-[13px]">
                  {candidate.name}
                  {candidate.burner ? ' (Burner)' : ''} · {candidate.count}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search passwords" spellCheck={false} className="pl-8" />
        </div>
      </div>

      {space?.burner && <p className="mb-3 text-[12px] text-muted-foreground">Burner Space: these passwords stay in memory and are forgotten when the Space closes.</p>}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {visible.length === 0 && <li className="px-4 py-10 text-center text-muted-foreground">{logins.length === 0 ? 'No saved passwords in this Space.' : 'No matches.'}</li>}
        {visible.map((login) => (
          <LoginRow key={login.id} login={login} run={run} />
        ))}
      </ul>

      {space && space.never.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">Never saved</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {space.never.map((origin) => (
              <li key={origin} className="flex h-10 items-center px-4">
                <span className="min-w-0 flex-1 truncate">{origin}</span>
                <button type="button" aria-label={`Remove ${origin}`} className={icon} onClick={() => run(api().removeNever(space.spaceId, origin))}>
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ExternalManagers />
    </main>
  );
}

function Banner({ tone, children, onClose }: { tone: 'warn' | 'info'; children: ReactNode; onClose?: () => void }) {
  return (
    <div role={tone === 'warn' ? 'alert' : 'status'} className={cn('mb-4 flex items-start gap-2 rounded-xl px-4 py-3', tone === 'warn' ? 'bg-amber-500/10 text-amber-200 light:text-amber-800' : 'bg-muted text-foreground')}>
      <div className="flex-1">{children}</div>
      {onClose && (
        <button type="button" aria-label="Close" className={cn(icon, 'size-6')} onClick={onClose}>
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

type Mode = 'idle' | 'confirm-reveal' | 'confirm-delete' | 'edit';

function LoginRow({ login, run }: { login: SavedLogin; run: (task: Promise<unknown>, done?: string) => void }) {
  const [mode, setMode] = useState<Mode>('idle');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [username, setUsername] = useState(login.username);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (revealed === null) return;
    const timer = window.setTimeout(() => setRevealed(null), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  useEffect(() => () => setRevealed(null), []);

  const reveal = (): void => {
    setMode('idle');
    api()
      .reveal(login.spaceId, login.id)
      .then(setRevealed)
      .catch(() => setRevealed(null));
  };

  const save = (): void => {
    const patch = { ...(username !== login.username ? { username } : {}), ...(password ? { password } : {}) };
    setPassword('');
    setMode('idle');
    if (Object.keys(patch).length > 0) run(api().update(login.spaceId, login.id, patch), 'Saved.');
  };

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{login.origin.replace(/^https:\/\//, '')}</p>
          <p className="truncate text-[12px] text-muted-foreground">{login.username || 'No username'}</p>
        </div>
        <code className="w-40 truncate text-right font-mono text-[12px] text-muted-foreground select-text">{revealed ?? '••••••••••'}</code>
        {revealed === null ? (
          <button type="button" aria-label="Show password" className={icon} onClick={() => setMode('confirm-reveal')}>
            <Eye className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : (
          <button type="button" aria-label="Hide password" className={icon} onClick={() => setRevealed(null)}>
            <EyeOff className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
        <button type="button" aria-label="Copy username" title="Copy username" className={icon} onClick={() => run(api().copy(login.spaceId, login.id, 'username'), 'Username copied.')}>
          <Copy className="size-3.5" strokeWidth={1.75} />
        </button>
        <button type="button" aria-label="Copy password" title="Copy password" className={icon} onClick={() => run(api().copy(login.spaceId, login.id, 'password'), 'Password copied. It is cleared from the clipboard in 30 seconds.')}>
          <KeyRound className="size-3.5" strokeWidth={1.75} />
        </button>
        <button type="button" aria-label="Edit" className={icon} onClick={() => setMode(mode === 'edit' ? 'idle' : 'edit')}>
          <Pencil className="size-3.5" strokeWidth={1.75} />
        </button>
        <button type="button" aria-label="Delete" className={icon} onClick={() => setMode('confirm-delete')}>
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      {mode === 'confirm-reveal' && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <span className="flex-1">Show this password? It hides again after 30 seconds.</span>
          <button type="button" className={solid} onClick={reveal}>Show</button>
          <button type="button" className={quiet} onClick={() => setMode('idle')}>Cancel</button>
        </div>
      )}
      {mode === 'confirm-delete' && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <span className="flex-1">Delete this saved password?</span>
          <button type="button" className={solid} onClick={() => run(api().remove(login.spaceId, login.id), 'Deleted.')}>Delete</button>
          <button type="button" className={quiet} onClick={() => setMode('idle')}>Cancel</button>
        </div>
      )}
      {mode === 'edit' && (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Input aria-label="Username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" spellCheck={false} className="h-8" />
          <Input aria-label="New password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password (optional)" autoComplete="new-password" className="h-8" />
          <button type="submit" className={solid}>Save</button>
        </form>
      )}
    </li>
  );
}

/** Installs the official extension through the normal review flow, then offers to turn Vela's own manager off. */
function ExternalManagers() {
  const [review, setReview] = useState<ExtensionReview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const install = (id: string): void => {
    setBusy(id);
    setError(null);
    velaPages()
      .extensions.install(id)
      .then(setReview)
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(null));
  };

  const confirm = (): void => {
    if (!review) return;
    const name = review.name;
    velaPages()
      .extensions.confirmInstall(review.token)
      .then(() => setInstalled(name))
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setReview(null));
  };

  const cancel = (): void => {
    if (review) settle(velaPages().extensions.cancelInstall(review.token));
    setReview(null);
  };

  return (
    <section className="mt-10 rounded-xl border border-border p-4">
      <div className="flex items-start gap-3">
        <Puzzle className="mt-0.5 size-4 text-muted-foreground" strokeWidth={1.75} />
        <div className="flex-1">
          <h2 className="font-medium">Use Bitwarden / 1Password instead</h2>
          <p className="mt-0.5 text-muted-foreground">Install the official extension from the Chrome Web Store. You review its permissions before it is added.</p>
          <div className="mt-3 flex gap-2">
            {MANAGERS.map((manager) => (
              <button key={manager.id} type="button" className={cn(quiet, 'border border-border')} disabled={busy !== null || review !== null} onClick={() => install(manager.id)}>
                {busy === manager.id ? 'Downloading…' : `Install ${manager.name}`}
              </button>
            ))}
          </div>
          {review && (
            <div className="mt-3 rounded-lg bg-muted px-3 py-2">
              <p>
                Add <span className="font-medium">{review.name}</span> {review.version}? It asks for {review.permissions.length} permission{review.permissions.length === 1 ? '' : 's'}.
              </p>
              <span className="mt-2 flex gap-2">
                <button type="button" className={solid} onClick={confirm}>Add extension</button>
                <button type="button" className={quiet} onClick={cancel}>Cancel</button>
              </span>
            </div>
          )}
          {installed && (
            <div className="mt-3 rounded-lg bg-muted px-3 py-2">
              <p>{installed} is installed. Turn off Vela's own password saving and autofill so the two do not both ask?</p>
              <span className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={solid}
                  onClick={() => {
                    settle(velaPages().setSettings({ offerToSavePasswords: false, passwordAutofill: false }));
                    setInstalled(null);
                  }}
                >
                  Turn off Vela passwords
                </button>
                <button type="button" className={quiet} onClick={() => setInstalled(null)}>Keep both</button>
              </span>
            </div>
          )}
          {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
        </div>
      </div>
    </section>
  );
}
