import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { velaPages } from '@/lib/vela';
import { Group, SwitchRow } from '../components/layout';
import { hasBridge, useSettings } from '../store';

/**
 * Settings → Privacy: "Reject cookie banners" plus the sites where banners are left alone.
 * Exceptions are added from the site-info popover (lock in the address bar).
 */
export function CookieBanners() {
  const { settings } = useSettings();
  const [sites, setSites] = useState<string[]>([]);

  useEffect(() => {
    if (!hasBridge()) return;
    void velaPages()
      .cookieBanners.exceptions()
      .then(setSites)
      .catch(() => undefined);
  }, []);

  const remove = (site: string): void => {
    setSites((current) => current.filter((entry) => entry !== site));
    void velaPages()
      .cookieBanners.removeException(site)
      .then(setSites)
      .catch(() => undefined);
  };

  return (
    <Group title="Cookie banners">
      <SwitchRow
        title="Reject cookie banners"
        description="Answer consent pop-ups with “reject” or “only necessary” and hide them. Works on the common consent tools; unknown banners are left alone."
        setting="rejectCookieBanners"
      />
      {settings.rejectCookieBanners && (
        <div className="px-4 py-3">
          <p className="text-[13px] leading-5 font-medium text-foreground">Sites that keep their banners</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Includes subdomains. Allow banners on a site from the lock in the address bar.</p>
          {sites.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground/70">No exceptions.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {sites.map((site) => (
                <li key={site} className="flex h-7 items-center gap-1 rounded-full bg-secondary pr-1 pl-2.5 text-[12px] text-foreground ring-1 ring-border">
                  {site}
                  <button
                    type="button"
                    aria-label={`Remove ${site}`}
                    onClick={() => remove(site)}
                    className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <X className="size-3" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Group>
  );
}
