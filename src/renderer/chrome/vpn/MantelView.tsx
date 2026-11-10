import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, KeyRoundIcon, Loader2Icon, ShieldCheckIcon, ShieldIcon, ZapIcon } from 'lucide-react';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Flag } from './Flag';
import { FASTEST_ID, LICENSE_HINT, TERM_DAYS, hash, licenseTerm, maskLicense, normalizeLicense, resolveServer } from './vpn-data';
import { MantelMark } from './parts';
import { useVpn, vpn, type VpnLicense } from './vpn-store';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function LicenseForm() {
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
    const key = normalizeLicense(value.trim());
    setValue(key);
    const message = await vpn.activate(key);
    setError(message);
    if (message) inputRef.current?.focus();
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 p-3.5" noValidate>
      <div className="flex items-center gap-3">
        <MantelMark />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold tracking-tight text-foreground">Activate your license</p>
          <p className="text-[11.5px] leading-snug text-muted-foreground">Paste the key from your MantelVPN account.</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="vpn-license" className="sr-only">
          License key
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
            id="vpn-license"
            value={value}
            spellCheck={false}
            autoComplete="off"
            placeholder={LICENSE_HINT}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : hintId}
            disabled={state.checking}
            onChange={(event) => {
              setValue(event.target.value.toUpperCase());
              if (error) setError(null);
            }}
            onPaste={(event) => {
              event.preventDefault();
              setValue(normalizeLicense(event.clipboardData.getData('text').trim()));
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
              className="px-1 text-[11.5px] text-red-500 dark:text-red-400"
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0, x: [0, -4, 4, -2, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: ease.out }}
            >
              {error}
            </motion.p>
          ) : (
            <motion.p key="hint" id={hintId} className="px-1 text-[11.5px] text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Format <span className="font-mono">{LICENSE_HINT}</span>, dashes are added on paste.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <button
        type="submit"
        disabled={state.checking || value.trim().length === 0}
        className="vpn-cta flex h-9 items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold tracking-tight outline-none transition-[opacity,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.98] disabled:cursor-default disabled:opacity-50"
      >
        {state.checking ? (
          <>
            <Loader2Icon className="size-4 animate-spin" strokeWidth={2} />
            Checking license…
          </>
        ) : (
          'Activate'
        )}
      </button>
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
        <circle cx="20" cy="20" r={radius} fill="none" strokeWidth={3} className="stroke-foreground/10" />
        <motion.circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          stroke="url(#vpn-ring-gradient)"
          strokeDasharray={circumference}
          initial={reduce ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - fraction) }}
          transition={{ duration: 0.9, ease: ease.out }}
        />
        <defs>
          <linearGradient id="vpn-ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
      </svg>
      <span className="text-[11px] leading-none font-semibold text-foreground tabular-nums">{daysLeft}</span>
    </span>
  );
}

function AccountCard({ license }: { license: VpnLicense }) {
  const [confirming, setConfirming] = useState(false);
  const term = licenseTerm(license.key, license.activatedAt);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <section aria-label="MantelVPN account" className="flex items-center gap-3 rounded-xl bg-foreground/[0.04] p-2.5 ring-1 ring-foreground/[0.06] ring-inset">
      <DaysRing daysLeft={term.daysLeft} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight text-foreground">
          Premium
          <span className="vpn-badge rounded-full px-1.5 py-px text-[9.5px] font-semibold tracking-wide">Partner</span>
        </p>
        <p className="text-[11.5px] text-muted-foreground tabular-nums">{term.daysLeft} days left</p>
        <p className="truncate text-[11px] text-muted-foreground/80 tabular-nums" title={maskLicense(license.key)}>
          Expires {dateFormat.format(term.expiresAt)} · <span className="font-mono text-[10.5px]">{license.key.slice(-4)}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => (confirming ? vpn.removeLicense() : setConfirming(true))}
        className={cn(
          'shrink-0 self-start rounded-md px-1.5 py-1 text-[11px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
          confirming ? 'bg-red-500/15 text-red-500 dark:text-red-400' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        {confirming ? 'Confirm remove' : 'Remove license'}
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
    <div className="relative grid size-[76px] place-items-center">
      {state.status === 'connected' &&
        !reduce &&
        [0, 1].map((ring) => (
          <motion.span
            key={ring}
            aria-hidden
            className="absolute inset-0 rounded-full border border-emerald-400/50"
            initial={{ scale: 0.7, opacity: 0.7 }}
            animate={{ scale: 1.35, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, delay: ring * 1.2, ease: 'easeOut' }}
          />
        ))}
      {state.status === 'connecting' && (
        <svg aria-hidden viewBox="0 0 76 76" className="absolute inset-0 animate-spin [animation-duration:1.1s]">
          <circle cx="38" cy="38" r="35" fill="none" strokeWidth={2.5} className="stroke-foreground/10" />
          <circle cx="38" cy="38" r="35" fill="none" strokeWidth={2.5} strokeLinecap="round" stroke="#fbbf24" strokeDasharray="60 160" />
        </svg>
      )}
      <motion.span
        className={cn(
          'relative grid size-14 place-items-center rounded-full ring-1 transition-colors duration-300 ring-inset',
          state.status === 'off' && 'bg-foreground/[0.05] text-muted-foreground ring-foreground/10',
          state.status === 'connecting' && 'bg-amber-400/10 text-amber-500 ring-amber-400/30 dark:text-amber-300',
          state.status === 'connected' && 'bg-emerald-400/15 text-emerald-600 ring-emerald-400/40 shadow-[0_0_32px_-6px_rgb(52_211_153/0.6)] dark:text-emerald-300',
        )}
        animate={state.status === 'connected' && !reduce ? { scale: [0.9, 1.06, 1] } : { scale: 1 }}
        transition={{ duration: 0.45, ease: ease.out }}
      >
        {state.status === 'connected' ? <ShieldCheckIcon className="size-6" strokeWidth={1.75} /> : <ShieldIcon className="size-6" strokeWidth={1.75} />}
      </motion.span>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[10px] bg-foreground/[0.04] px-2.5 py-1.5">
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p className="flex items-center gap-1 truncate font-mono text-[12px] font-medium text-foreground tabular-nums">
        {icon}
        {value}
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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={spring.soft}
    >
      <Stat label="Virtual IP" value={state.ip ?? '—'} />
      <Stat label="Uptime" value={formatUptime(seconds)} />
      <Stat label="Downloaded" value={formatBytes(traffic.down)} icon={<ArrowDownIcon aria-hidden className="size-3 text-emerald-500" strokeWidth={2.25} />} />
      <Stat label="Uploaded" value={formatBytes(traffic.up)} icon={<ArrowUpIcon aria-hidden className="size-3 text-sky-500" strokeWidth={2.25} />} />
    </motion.div>
  );
}

function LocationButton() {
  const state = useVpn();
  const fastest = state.serverId === FASTEST_ID;
  const server = state.activeServerId && state.status !== 'off' ? resolveServer(state.activeServerId) : resolveServer(state.serverId);
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
        <span className="block truncate text-[12.5px] font-medium text-foreground">{fastest ? 'Fastest server' : `${server.city}, ${server.country}`}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {fastest ? `${server.city}, ${server.country} · ` : ''}
          {server.ping} ms · {server.load}% load
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
      onClick={() => (state.status === 'off' ? vpn.connect() : vpn.disconnect())}
      aria-label={state.status === 'connecting' ? 'Connecting, press to cancel' : label}
      className={cn(
        'relative flex h-12 w-full items-center justify-center overflow-hidden rounded-xl text-[14px] font-semibold tracking-tight outline-none transition-[background-color,color,box-shadow,transform] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.98]',
        state.status === 'off' && 'vpn-cta',
        state.status === 'connecting' && 'bg-amber-400/15 text-amber-600 ring-1 ring-amber-400/30 ring-inset dark:text-amber-200',
        state.status === 'connected' && 'bg-foreground/[0.07] text-foreground ring-1 ring-foreground/10 ring-inset hover:bg-red-500/15 hover:text-red-500 dark:hover:text-red-300',
      )}
    >
      {state.status === 'connecting' && !reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-amber-400/20"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 1.5, ease: ease.inOut }}
        />
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={label}
          className="relative"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: ease.out }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function ConnectSection() {
  const state = useVpn();
  const server = state.activeServerId ? resolveServer(state.activeServerId) : null;
  const caption =
    state.status === 'connected' && server
      ? `Connected to ${server.city}`
      : state.status === 'connecting' && server
        ? `Securing tunnel to ${server.city}…`
        : 'Not connected';
  return (
    <div className="flex flex-col items-center gap-3">
      <StatusOrb />
      <p aria-live="polite" className={cn('-mt-1 text-[12.5px] font-medium', state.status === 'connected' ? 'text-emerald-600 dark:text-emerald-300' : 'text-muted-foreground')}>
        {caption}
      </p>
      <LocationButton />
      <ConnectButton />
      <AnimatePresence initial={false}>{state.status === 'connected' && <ConnectedStats key="stats" />}</AnimatePresence>
    </div>
  );
}

/** MantelVPN: license entry until activated, then account card + location + connect. */
export function MantelView() {
  const state = useVpn();
  if (!state.license) return <LicenseForm />;
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin]">
      <AccountCard license={state.license} />
      <ConnectSection />
      <p className="text-center text-[10.5px] leading-snug text-muted-foreground/70">Preview: no traffic is routed yet. Values are simulated.</p>
    </div>
  );
}
