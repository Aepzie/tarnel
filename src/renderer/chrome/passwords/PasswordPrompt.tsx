import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { KeyRound, TriangleAlert, User, X } from 'lucide-react';
import type { PasswordFillOffer, PasswordSavePrompt } from '@shared/passwords';
import { useBrowserState } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { answerSave, dismissOffer, fillAccount, usePasswordQueue } from './password-store';

const CARD_WIDTH = 320;
const EDGE = 8;
const GAP = 10;

function placement(): { left: number; top: number } {
  const rect = document.querySelector('[data-omnibox]')?.getBoundingClientRect();
  const maxLeft = Math.max(EDGE, window.innerWidth - CARD_WIDTH - EDGE);
  if (!rect || rect.width === 0) return { left: maxLeft, top: 56 };
  return { left: Math.min(maxLeft, Math.max(EDGE, rect.right - CARD_WIDTH)), top: rect.bottom + GAP };
}

/**
 * Password save prompt and account picker, anchored under the right end of the address area.
 * Only for the active tab; a prompt for a background tab waits until that tab is shown.
 */
export function PasswordPrompt() {
  const { saves, offers } = usePasswordQueue();
  const { activeTabId } = useBrowserState();
  const save = saves.find((prompt) => prompt.tabId === activeTabId);
  const offer = save ? undefined : offers.find((pending) => pending.tabId === activeTabId);
  useOverlayPresence(!!(save || offer));

  return (
    <AnimatePresence>
      {save && <SaveCard key={save.id} prompt={save} />}
      {offer && <OfferCard key={offer.id} offer={offer} />}
    </AnimatePresence>
  );
}

function Card({ children, label, onEscape }: { children: ReactNode; label: string; onEscape: () => void }) {
  const reduced = useReducedMotion();
  const [place, setPlace] = useState(placement);
  useLayoutEffect(() => {
    const measure = (): void => setPlace(placement());
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape]);
  return (
    <motion.div
      role="dialog"
      aria-label={label}
      style={{ left: place.left, top: place.top, width: CARD_WIDTH, transformOrigin: `${CARD_WIDTH - 24}px 0px` }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0, transition: spring.soft }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.14, ease: ease.out } }}
      className="no-drag fixed z-50 text-[13px] text-zinc-100 select-none light:text-zinc-900"
    >
      <div className="relative overflow-hidden rounded-2xl bg-zinc-900/85 p-3.5 shadow-[0_0_0_1px_rgb(255_255_255/0.07),0_18px_48px_-16px_rgb(0_0_0/0.65)] backdrop-blur-2xl light:bg-white/90 light:shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_18px_48px_-16px_rgb(0_0_0/0.25)]">
        {children}
      </div>
    </motion.div>
  );
}

const quiet = 'h-8 rounded-[8px] px-3 font-medium text-zinc-300 transition-colors duration-150 outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[var(--ring)] light:text-zinc-700 light:hover:bg-black/[0.06]';

function SaveCard({ prompt }: { prompt: PasswordSavePrompt }) {
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => saveRef.current?.focus({ preventScroll: true }), []);
  const update = prompt.kind === 'update';
  return (
    <Card label={update ? 'Update password' : 'Save password'} onEscape={() => answerSave(prompt.id, 'dismiss')}>
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white/[0.06] text-zinc-300 light:bg-black/[0.05] light:text-zinc-600">
          <KeyRound className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="leading-snug text-zinc-200 light:text-zinc-700">
            {update ? 'Update password for ' : 'Save password for '}
            <span className="font-medium break-all text-zinc-50 light:text-zinc-950">{prompt.host}</span>?
          </p>
          <p className="mt-0.5 truncate text-[12px] text-zinc-500">
            {prompt.username || 'No username'}
            {prompt.burner ? ' · Burner Space, forgotten when closed' : ''}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1">
        {!update && (
          <button type="button" className={cn(quiet, 'mr-auto px-2 text-[12px] text-zinc-400')} onClick={() => answerSave(prompt.id, 'never')}>
            Never for this site
          </button>
        )}
        <button type="button" className={quiet} onClick={() => answerSave(prompt.id, 'dismiss')}>
          Dismiss
        </button>
        <button
          ref={saveRef}
          type="button"
          onClick={() => answerSave(prompt.id, 'save')}
          className="h-8 rounded-[8px] bg-zinc-100 px-3.5 font-medium text-zinc-950 transition-[filter,transform] duration-150 outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:scale-[0.97] light:bg-zinc-900 light:text-zinc-50"
        >
          {update ? 'Update' : 'Save'}
        </button>
      </div>
    </Card>
  );
}

function OfferCard({ offer }: { offer: PasswordFillOffer }) {
  return (
    <Card label="Saved accounts" onEscape={() => dismissOffer(offer.id)}>
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="size-3.5 shrink-0 text-zinc-400" strokeWidth={1.75} />
        <p className="min-w-0 flex-1 truncate text-[12px] text-zinc-400 light:text-zinc-600">
          Sign in to <span className="text-zinc-200 light:text-zinc-800">{offer.host}</span>
        </p>
        <button type="button" aria-label="Dismiss" onClick={() => dismissOffer(offer.id)} className="flex size-6 items-center justify-center rounded-md text-zinc-500 outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[var(--ring)] light:hover:bg-black/[0.06]">
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      {offer.insecure && (
        <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[12px] text-amber-300 light:text-amber-700">
          <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
          Not a secure connection. Others on the network could see it.
        </p>
      )}
      <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        {offer.accounts.map((account) => (
          <li key={account.id}>
            <button
              type="button"
              onClick={() => fillAccount(offer.id, account.id)}
              className="flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2 text-left outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[var(--ring)] light:hover:bg-black/[0.05]"
            >
              <User className="size-3.5 shrink-0 text-zinc-500" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">{account.username || 'No username'}</span>
              <span className="text-[11px] text-zinc-500">Fill</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
