import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { ChevronRightIcon, GlobeIcon, ShieldIcon } from 'lucide-react';
import { ease } from '@/lib/motion';
import { accountTerm } from './vpn-data';
import { MantelView } from './MantelView';
import { ServerPicker } from './ServerPicker';
import { BackButton, MantelMark, PreviewChip, StatusDot } from './parts';
import { useVpn, vpn } from './vpn-store';

function MantelCard() {
  const state = useVpn();
  const signedIn = state.mode !== 'signed-out';
  const term = accountTerm(state.paidUntil);
  return (
    <button
      type="button"
      onClick={() => vpn.setView('mantel')}
      className="group relative block w-full rounded-[14px] text-left outline-none transition-transform duration-150 ease-out hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:translate-y-0 active:scale-[0.99] motion-reduce:hover:translate-y-0"
    >
      <span aria-hidden className="vpn-ring vpn-orbit pointer-events-none absolute inset-0 rounded-[14px]" />
      <span className="vpn-card relative block overflow-hidden rounded-[14px] p-3">
        <span className="relative flex items-center gap-3">
          <MantelMark />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold tracking-tight text-foreground">MantelVPN</span>
              <span className="vpn-badge rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide">Partner</span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              {signedIn ? (
                <>
                  <StatusDot status={state.status} />
                  {state.status === 'connected' ? 'Connected' : state.status === 'connecting' ? 'Connecting' : 'Signed in'}
                  {term ? ` · ${term.daysLeft} days left` : ''}
                </>
              ) : (
                'Partner network for Vela · sign in with your account number'
              )}
            </span>
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/70 transition-[transform,color] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-foreground" strokeWidth={1.75} />
        </span>
      </span>
    </button>
  );
}

const listIn: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.025 } } };
const itemIn: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.12, ease: ease.out } },
};
const itemFade: Variants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.12 } } };

function OtherProvider({ name, variants }: { name: string; variants: Variants }) {
  return (
    <motion.li variants={variants} className="flex h-10 items-center gap-3 rounded-[10px] px-2">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-foreground/[0.06] text-muted-foreground">
        <GlobeIcon className="size-[15px]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 text-[13px] font-medium tracking-tight text-foreground/80">{name}</span>
      <span className="rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground/80">Coming soon</span>
    </motion.li>
  );
}

function ProvidersView({ animateIn }: { animateIn: boolean }) {
  const reduce = useReducedMotion();
  const item = reduce ? itemFade : itemIn;
  return (
    <motion.div className="flex flex-col gap-3.5 p-3" variants={listIn} initial={animateIn ? 'hidden' : false} animate="show">
      <motion.div variants={item}>
        <MantelCard />
      </motion.div>
      <div>
        <motion.p variants={item} className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
          Other providers
        </motion.p>
        <ul aria-label="Other providers">
          <OtherProvider name="Mullvad" variants={item} />
          <OtherProvider name="Proton VPN" variants={item} />
        </ul>
        <motion.p variants={item} className="px-2 pt-1.5 text-[11px] leading-snug text-muted-foreground/70">
          Support for more providers is planned. Bring your own account when it lands.
        </motion.p>
      </div>
    </motion.div>
  );
}

function Header({ children }: { children: ReactNode }) {
  const { mode } = useVpn();
  return (
    <header className="flex h-11 shrink-0 items-center gap-2.5 px-3.5">
      {children}
      {mode === 'preview' && (
        <span className="ml-auto">
          <PreviewChip />
        </span>
      )}
    </header>
  );
}

/** VPN popover: provider list → MantelVPN (sign-in, account, connect) → server picker. */
export function VpnPanel() {
  const state = useVpn();
  const reduce = useReducedMotion();
  const firstMount = useRef(true);
  useEffect(() => {
    firstMount.current = false;
  }, []);
  const title = state.view === 'providers' ? 'VPN' : state.view === 'mantel' ? 'MantelVPN' : 'Choose a server';
  const subtitle = state.status === 'connected' ? 'Protected' : state.status === 'connecting' ? 'Connecting…' : state.view === 'providers' ? 'Providers' : '';

  return (
    <div className="flex max-h-[min(620px,calc(100vh-72px))] flex-col">
      <Header>
        {state.view === 'providers' ? (
          <span className="grid size-6 place-items-center rounded-md bg-space/15 text-space">
            <ShieldIcon className="size-3.5" strokeWidth={2} />
          </span>
        ) : (
          <BackButton label={state.view === 'servers' ? 'MantelVPN' : 'providers'} to={state.view === 'servers' ? 'mantel' : 'providers'} />
        )}
        <span className="text-[13px] font-semibold tracking-tight text-foreground">{title}</span>
        {subtitle && <span className="text-[12px] text-muted-foreground">{subtitle}</span>}
      </Header>
      <div className="mx-3 h-px shrink-0 bg-border" />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={state.view}
          className="flex min-h-0 flex-1 flex-col"
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 16, filter: 'blur(4px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16, filter: 'blur(4px)' }}
          transition={{ duration: 0.2, ease: ease.out }}
        >
          {state.view === 'providers' && <ProvidersView animateIn={firstMount.current} />}
          {state.view === 'mantel' && <MantelView />}
          {state.view === 'servers' && <ServerPicker />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
