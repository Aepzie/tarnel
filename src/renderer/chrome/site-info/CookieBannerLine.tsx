import { useEffect, useState } from 'react';
import { MessageSquareOff } from 'lucide-react';
import type { CookieBannerTabInfo } from '@shared/cookie-banners';
import { vela } from '@/lib/vela';

const toggleBtn =
  'inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[12px] font-medium text-zinc-300 transition-colors duration-150 outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50 light:text-zinc-700 light:hover:bg-black/[0.06]';

function summary(info: CookieBannerTabInfo): string {
  if (info.allowed) return 'Cookie banners allowed on this site';
  if (info.handled === 0) return 'No cookie banner rejected on this page';
  return `${info.handled} cookie banner${info.handled === 1 ? '' : 's'} rejected on this page`;
}

/** Site-info popover line: banners handled in this tab + "Allow banners on this site". Hidden when the feature is off. */
export function CookieBannerLine({ tabId }: { tabId: number }) {
  const [info, setInfo] = useState<CookieBannerTabInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    let live = true;
    vela()
      .cookieBanners.tab(tabId)
      .then((next) => live && setInfo(next))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tabId]);

  if (!info || !info.enabled || !info.site) return null;

  const toggle = (): void => {
    setBusy(true);
    vela()
      .cookieBanners.setAllowed(tabId, !info.allowed)
      .then((next) => {
        setInfo(next);
        setChanged(true);
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex items-start gap-2.5 border-t border-white/[0.06] px-4 py-3 light:border-black/[0.06]">
      <MessageSquareOff className="mt-px size-4 shrink-0 text-zinc-400" strokeWidth={1.75} />
      <div className="min-w-0 flex-1 leading-snug">
        {summary(info)}
        {changed && <span className="block text-[11.5px] text-zinc-500">Takes effect when the page reloads.</span>}
      </div>
      <button type="button" className={toggleBtn} disabled={busy} onClick={toggle}>
        {info.allowed ? 'Reject banners' : 'Allow banners'}
      </button>
    </div>
  );
}
