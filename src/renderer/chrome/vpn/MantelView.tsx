import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronRightIcon, KeyRoundIcon, Loader2Icon, ShieldCheckIcon, ShieldIcon, ZapIcon } from 'lucide-react';
import { ease } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Flag } from './Flag';
import { formatAccountNumber, normalizeAccountNumber, normalizeTotp } from '@shared/vpn';
import { FASTEST_ID, TERM_DAYS, accountTerm, hash, resolveServer } from './vpn-data';
import { MantelMark, StatusDot } from './parts';
import { useVpn, vpn } from './vpn-store';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const quick = { duration: 0.2, ease: ease.out };

/** Numbers that change roll in per character instead of jumping; unchanged characters stay put. */
function RollingText({ value, className }: { value: string; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={cn('tabular-nums', className)}>{value}</span>;
  const chars = value.split('');
  return (
    <span className={cn('inline-flex overflow-hidden tabular-nums', className)} aria-label={value}>
      {chars.map((char, index) => (
        <span key={chars.length - index} aria-hidden className="relative inline-block">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={char}
              className="inline-block whitespace-pre"
              initial={{ y: '60%', opacity: 0 }}
              animate={{ y: '0%', opacity: 1 }}
              exit={{ y: '-60%', opacity: 0 }}
              transition={{ duration: 0.18, ease: ease.out }}
            >
              {char}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}

function AccountForm() {
  const state = useVpn();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const hintId = useId();

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (state.checking) return;
    const accountNumber = normalizeAccountNumber(value);
    if (!accountNumber) {
      setError('An account number has exactly 16 digits.');
      inputRef.current?.focus();
      return;
    }
    const message = await vpn.signIn(accountNumber);
    setError(message);
    if (message) inputRef.current?.focus();
    else setValue('');
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 p-3.5" noValidate>
      <div className="flex items-center gap-3">
        <MantelMark />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold tracking-tight text-foreground">Sign in to MantelVPN</p>
          <p className="text-[12px] leading-snug text-muted-foreground">Enter the 16-digit account number from your Mantel account.</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="vpn-account" className="sr-only">
          Account number
        </label>
        <div
          className={cn(
            'flex h-10 items-center gap-2 rounded-[10px] bg-foreground/[0.05] px-3 ring-1 ring-foreground/10 transition-shadow duration-150 ring-inset focus-within:ring-2 focus-within:ring-space/60',
            error && 'ring-red-400/70 focus-within:ring-red-400/80',
          )}
        >
          <KeyRoundIcon aria-hidden className="size-[15px] shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <input
            ref={inputRef}
            id="vpn-account"
            value={value}
            spellCheck={false}
            autoComplete="off"
            inputMode="numeric"
            placeholder="0000 0000 0000 0000"
            aria-invalid={!!error}
            aria-describedby={error ? errorId : hintId}
            disabled={state.checking}
            onChange={(event) => {
              setValue(formatAccountNumber(event.target.value));
              if (error) setError(null);
            }}
            onPaste={(event) => {
              event.preventDefault();
              setValue(formatAccountNumber(event.clipboardData.getData('text')));
              setError(null);
            }}
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] tracking-wider text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
          />
        </div>
        <AnimatePresence initial={false} mode="wait">
          {error ? (
            <motion.p
              key="error"
              id={errorId}
              role="alert"
              className="px-1 text-[11px] leading-snug text-red-500 dark:text-red-400"
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0, x: [0, -4, 4, -2, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: ease.out }}
            >
              {error}
            </motion.p>
          ) : (
            <motion.p key="hint" id={hintId} className="px-1 text-[11px] leading-snug text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={quick}>
              16 digits. Spaces and dashes from a paste are fine. Stored encrypted on this device.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <button
        type="submit"
        disabled={state.checking || value.trim().length === 0}
        className="vpn-cta flex h-9 items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold tracking-tight outline-none transition-[opacity,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.97] disabled:cursor-default disabled:opacity-50"
      >
        {state.checking ? (
          <>
            <Loader2Icon className="size-3.5 animate-spin" strokeWidth={2} />
            Signing in…
          </>
        ) : (
          'Sign in'
        )}
      </button>
    </form>
  );
}

/** Two-factor step: shown when Mantel asks for a code at sign-in or to renew an expired session. */
function TotpForm() {
  const state = useVpn();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (code: string): Promise<void> => {
    if (state.checking) return;
    if (!normalizeTotp(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      inputRef.current?.focus();
      return;
    }
    const message = await vpn.verifyTotp(code);
    setError(message);
    if (message) {
      setValue('');
      inputRef.current?.focus();
    }
  };

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void submit(value);
      }}
      className="flex flex-col gap-3 p-3.5"
      noValidate
    >
      <div className="flex items-center gap-3">
        <MantelMark />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold tracking-tight text-foreground">Two-factor code</p>
          <p className="text-[12px] leading-snug text-muted-foreground">Enter the current code from your authenticator app.</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="vpn-totp" className="sr-only">
          Two-factor code
        </label>
        <input
          ref={inputRef}
          id="vpn-totp"
          value={value}
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          maxLength={8}
          placeholder="000000"
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          disabled={state.checking}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
            setValue(digits);
            if (error) setError(null);
            if (digits.length === 6) void submit(digits);
          }}
          className={cn(
            'h-11 rounded-[10px] bg-foreground/[0.05] text-center font-mono text-[20px] tracking-[0.4em] text-foreground outline-none ring-1 ring-foreground/10 ring-inset transition-shadow duration-150 placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-space/60 disabled:opacity-60',
            error && 'ring-red-400/70 focus:ring-red-400/80',
          )}
        />
        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              key="error"
              id={errorId}
              role="alert"
              className="px-1 text-[11px] leading-snug text-red-500 dark:text-red-400"
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0, x: [0, -4, 4, -2, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: ease.out }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void vpn.signOut()}
          className="h-9 flex-1 rounded-[10px] text-[12.5px] font-medium text-muted-foreground transition-colors duration-150 outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Use another account
        </button>
        <button
          type="submit"
          disabled={state.checking || value.length < 6}
          className="vpn-cta flex h-9 flex-1 items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold tracking-tight outline-none transition-[opacity,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:cursor-default disabled:opacity-50"
        >
          {state.checking ? <Loader2Icon className="size-3.5 animate-spin" strokeWidth={2} /> : null}
          {state.checking ? 'Checking…' : 'Verify'}
        </button>
      </div>
    </form>
  );
}

function DaysRing({ daysLeft }: { daysLeft: number }) {
  const reduce = useReducedMotion();
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, daysLeft / TERM_DAYS);
  return (
    <span className="relative grid size-11 shrink-0 place-items-center">
      <svg aria-hidden viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
        <circle cx="20" cy="20" r={radius} fill="none" strokeWidth={2} className="stroke-foreground/[0.08]" />
        <motion.circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          stroke="var(--vpn-accent)"
          strokeDasharray={circumference}
          initial={reduce ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - fraction) }}
          transition={{ duration: 0.7, delay: 0.08, ease: ease.out }}
        />
      </svg>
      <span className="text-[11px] leading-none font-medium text-foreground tabular-nums">{daysLeft}</span>
    </span>
  );
}

function AccountCard() {
  const state = useVpn();
  const [confirming, setConfirming] = useState(false);
  const term = accountTerm(state.paidUntil);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <section aria-label="MantelVPN account" className="flex items-center gap-3 rounded-xl bg-foreground/[0.04] p-2.5 ring-1 ring-foreground/[0.06] ring-inset">
      {term ? <DaysRing daysLeft={term.daysLeft} /> : <MantelMark className="size-11" />}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-medium tracking-tight text-foreground">
          {term && term.daysLeft === 0 ? 'Expired' : 'Mantel account'}
          <span className="rounded-full bg-foreground/[0.06] px-1.5 py-px text-[10px] font-medium tracking-wide text-muted-foreground">Partner</span>
        </p>
        <p className="text-[12px] text-muted-foreground tabular-nums">{term ? `${term.daysLeft} days left` : 'Paid time unknown while offline'}</p>
        <p className="truncate text-[11px] text-muted-foreground/70 tabular-nums" title={`Account ending ${state.accountTail ?? ''}`}>
          {term ? `Paid until ${dateFormat.format(term.expiresAt)} · ` : ''}
          <span className="font-mono text-[10.5px]">••{state.accountTail}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => (confirming ? void vpn.signOut() : setConfirming(true))}
        className={cn(
          'shrink-0 self-start rounded-md px-1.5 py-1 text-[11px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
          confirming ? 'bg-red-500/15 text-red-500 dark:text-red-400' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        {confirming ? 'Confirm sign out' : 'Sign out'}
      </button>
    </section>
  );
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (part: number): string => String(part).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Mock traffic: a deterministic wobbling rate integrated over the uptime. */
function mockTraffic(seconds: number, seed: number): { down: number; up: number } {
  const base = 180_000 + (seed % 120_000);
  const down = seconds * base + Math.sin(seconds / 3) * base * 0.6 + base * 0.6;
  return { down: Math.max(0, down), up: Math.max(0, down * 0.11) };
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function StatusOrb() {
  const state = useVpn();
  const reduce = useReducedMotion();
  return (
    <div className="relative grid size-16 place-items-center">
      <AnimatePresence>
        {state.status === 'connecting' && (
          <motion.svg
            key="spinner"
            aria-hidden
            viewBox="0 0 64 64"
            className="absolute inset-0 animate-spin [animation-duration:1.2s]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={quick}
          >
            <circle cx="32" cy="32" r="30.5" fill="none" strokeWidth={1.5} strokeLinecap="round" className="stroke-foreground/40" strokeDasharray="40 152" />
          </motion.svg>
        )}
      </AnimatePresence>
      <motion.span
        className={cn(
          'relative grid size-14 place-items-center rounded-full bg-foreground/[0.05] ring-1 transition-[color,box-shadow] duration-200 ring-inset',
          state.status === 'connected'
            ? 'text-foreground ring-[color-mix(in_oklab,var(--vpn-accent)_45%,transparent)]'
            : 'text-muted-foreground ring-foreground/10',
        )}
        animate={state.status === 'connected' && !reduce ? { scale: [0.96, 1.03, 1] } : { scale: 1 }}
        transition={{ duration: 0.25, ease: ease.out }}
      >
        {state.status === 'connected' ? <ShieldCheckIcon className="size-[22px]" strokeWidth={1.5} /> : <ShieldIcon className="size-[22px]" strokeWidth={1.5} />}
        <AnimatePresence>
          {state.status === 'connected' && (
            <motion.span
              key="tick"
              aria-hidden
              className="absolute -right-0.5 -bottom-0.5 grid size-[18px] place-items-center rounded-full bg-[var(--vpn-accent)] text-white ring-2 ring-background"
              initial={reduce ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.22, delay: reduce ? 0 : 0.08, ease: ease.out }}
            >
              <CheckIcon className="size-2.5" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.span>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[10px] bg-foreground/[0.04] px-2.5 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="flex items-center gap-1 truncate text-[12px] font-medium text-foreground tabular-nums">
        {icon}
        <RollingText value={value} />
      </p>
    </div>
  );
}

function ConnectedStats() {
  const state = useVpn();
  const now = useNow(state.status === 'connected');
  const seconds = state.connectedAt ? Math.max(0, Math.floor((now - state.connectedAt) / 1000)) : 0;
  const traffic = mockTraffic(seconds, hash(state.activeServerId ?? ''));
  return (
    <motion.div
      className="grid w-full grid-cols-2 gap-1.5"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 2 }}
      transition={{ ...quick, delay: 0.06 }}
    >
      <Stat label={state.mode === 'live' ? 'Exit server' : 'Virtual IP'} value={state.ip ?? '—'} />
      <Stat label="Uptime" value={formatUptime(seconds)} />
      {state.mode === 'live' ? (
        <>
          <Stat label="Routing" value="Active Space" />
          <Stat label="Via" value="Mantel proxy" />
        </>
      ) : (
        <>
          <Stat label="Downloaded" value={formatBytes(traffic.down)} icon={<ArrowDownIcon aria-hidden className="size-3 text-muted-foreground" strokeWidth={2} />} />
          <Stat label="Uploaded" value={formatBytes(traffic.up)} icon={<ArrowUpIcon aria-hidden className="size-3 text-muted-foreground" strokeWidth={2} />} />
        </>
      )}
    </motion.div>
  );
}

function LocationButton() {
  const state = useVpn();
  const fastest = state.serverId === FASTEST_ID;
  const server = resolveServer(state.servers, state.activeServerId && state.status !== 'off' ? state.activeServerId : state.serverId);
  if (!server) return <p className="py-2 text-center text-[12px] text-muted-foreground">No Mantel locations available right now.</p>;
  const detail = [server.ping !== null ? `${server.ping} ms` : null, server.load !== null ? `${server.load}% load` : null, server.online ? null : 'offline']
    .filter(Boolean)
    .join(' · ');
  return (
    <button
      type="button"
      onClick={() => vpn.setView('servers')}
      aria-label={`Server: ${fastest ? 'Fastest, ' : ''}${server.city}, ${server.country}. Change server`}
      className="group flex h-11 w-full items-center gap-2.5 rounded-xl bg-foreground/[0.04] px-3 text-left ring-1 ring-foreground/[0.06] outline-none transition-colors duration-150 ring-inset hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-ring"
    >
      {fastest ? (
        <span className="grid w-5 shrink-0 place-items-center text-amber-500 dark:text-amber-300">
          <ZapIcon className="size-[15px]" strokeWidth={1.75} />
        </span>
      ) : (
        <Flag code={server.countryCode} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{fastest ? 'Fastest server' : `${server.city}, ${server.country}`}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {fastest ? `${server.city}, ${server.country}${detail ? ' · ' : ''}` : ''}
          {detail || (fastest ? '' : server.country)}
        </span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={1.75} />
    </button>
  );
}

function ConnectButton() {
  const state = useVpn();
  const reduce = useReducedMotion();
  const label = state.status === 'off' ? 'Connect' : state.status === 'connecting' ? 'Connecting…' : 'Disconnect';
  return (
    <button
      type="button"
      onClick={() => (state.status === 'off' ? void vpn.connect() : vpn.disconnect())}
      aria-label={state.status === 'connecting' ? 'Connecting, press to cancel' : label}
      className={cn(
        'relative flex h-10 w-full items-center justify-center overflow-hidden rounded-xl text-[13px] font-semibold tracking-tight outline-none transition-[background-color,color,box-shadow,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.97]',
        state.status === 'off' && 'vpn-cta hover:opacity-90',
        state.status === 'connecting' && 'bg-foreground/[0.07] text-muted-foreground ring-1 ring-foreground/10 ring-inset',
        state.status === 'connected' && 'bg-foreground/[0.07] text-foreground ring-1 ring-foreground/10 ring-inset hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-300',
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={label}
          className="relative flex items-center gap-2"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: 0.15, ease: ease.out }}
        >
          {state.status === 'connecting' && <Loader2Icon aria-hidden className="size-3.5 animate-spin" strokeWidth={2} />}
          {label}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function ConnectSection() {
  const state = useVpn();
  const server = state.activeServerId ? resolveServer(state.servers, state.activeServerId) : null;
  const caption =
    state.status === 'connected' && server
      ? `Connected to ${server.city}`
      : state.status === 'connecting' && server
        ? `Connecting to ${server.city}…`
        : 'Not connected';
  return (
    <div className="flex flex-col items-center gap-3">
      <StatusOrb />
      <p aria-live="polite" className={cn('-mt-1 flex items-center gap-2 text-[12px] font-medium transition-colors duration-200', state.status === 'connected' ? 'text-foreground' : 'text-muted-foreground')}>
        <StatusDot status={state.status} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={caption} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: ease.out }}>
            {caption}
          </motion.span>
        </AnimatePresence>
      </p>
      <LocationButton />
      <ConnectButton />
      {state.error && (
        <p role="alert" className="-mt-1 px-1 text-center text-[11px] leading-snug text-red-500 dark:text-red-400">
          {state.error}
        </p>
      )}
      <AnimatePresence initial={false}>{state.status === 'connected' && <ConnectedStats key="stats" />}</AnimatePresence>
    </div>
  );
}

/** MantelVPN: account number sign-in, then account card + location + connect. */
export function MantelView() {
  const state = useVpn();
  const reduce = useReducedMotion();
  const signedOut = state.mode === 'signed-out';
  const step = state.totpRequired ? 'totp' : signedOut ? 'sign-in' : 'account';
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        className="flex min-h-0 flex-col"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={quick}
      >
        {step === 'totp' ? (
          <TotpForm />
        ) : signedOut ? (
          <AccountForm />
        ) : (
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin]">
            <AccountCard />
            <ConnectSection />
            <p className="text-center text-[11px] leading-snug text-muted-foreground/70">
              {state.mode === 'live'
                ? 'Connect routes the active Space through a Mantel proxy on this location. Other Spaces stay direct.'
                : (state.notice ?? 'Preview: Mantel is not reachable. Servers and the connection are simulated.')}
            </p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
