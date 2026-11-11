import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { AtSign, Loader2 } from 'lucide-react';
import { aliasProviderLabel, type AliasOffer } from '@shared/aliases';
import { useBrowserState } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { cn } from '@/lib/utils';
import { Card, quiet } from '../passwords/PasswordPrompt';
import { usePasswordQueue } from '../passwords/password-store';
import { createAlias, dismissAlias, useAliasOffers } from './alias-store';

/**
 * "Use an alias for example.com?" — shown when an email field of a sign-up form is focused in the
 * active tab. Same anchor as the password cards; a password card for the tab takes precedence.
 */
export function AliasPrompt() {
  const offers = useAliasOffers();
  const { saves, offers: fills } = usePasswordQueue();
  const { activeTabId } = useBrowserState();
  const passwordCard = saves.some((prompt) => prompt.tabId === activeTabId) || fills.some((offer) => offer.tabId === activeTabId);
  const offer = passwordCard ? undefined : offers.find((pending) => pending.tabId === activeTabId);
  useOverlayPresence(!!offer);
  return <AnimatePresence>{offer && <AliasCard key={offer.id} offer={offer} />}</AnimatePresence>;
}

function AliasCard({ offer }: { offer: AliasOffer }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  useEffect(() => createRef.current?.focus({ preventScroll: true }), []);
  const dismiss = useCallback(() => dismissAlias(offer.id), [offer.id]);
  const create = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    createAlias(offer.id)
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
        setError(message || 'The alias could not be created.');
      })
      .finally(() => setBusy(false));
  };
  const provider = aliasProviderLabel(offer.provider);
  return (
    <Card label="Email alias" onEscape={dismiss}>
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white/[0.06] text-zinc-300 light:bg-black/[0.05] light:text-zinc-600">
          <AtSign className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="leading-snug text-zinc-200 light:text-zinc-700">
            Use an alias for <span className="font-medium break-all text-zinc-50 light:text-zinc-950">{offer.site}</span>?
          </p>
          <p className={cn('mt-0.5 text-[12px]', error ? 'text-amber-300 light:text-amber-700' : 'text-zinc-500')}>
            {error ?? `${provider} creates a forwarding address and fills it in.`}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1">
        <button type="button" className={quiet} onClick={dismiss}>
          Not now
        </button>
        <button
          ref={createRef}
          type="button"
          disabled={busy}
          onClick={create}
          className="flex h-8 items-center gap-1.5 rounded-[8px] bg-zinc-100 px-3.5 font-medium text-zinc-950 transition-[filter,transform] duration-150 outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:scale-[0.97] disabled:opacity-70 light:bg-zinc-900 light:text-zinc-50"
        >
          {busy && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2} />}
          Create alias
        </button>
      </div>
    </Card>
  );
}
