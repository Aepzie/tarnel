import { useEffect, useId, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { SpaceSiteDataPolicy } from '@shared/ipc';
import { normalizeSitePattern, type SiteDataPolicy } from '@shared/site-data';
import { Switch } from '@/components/ui/switch';
import { velaPages } from '@/lib/vela';
import { Group, Row } from '../components/layout';
import { hasBridge } from '../store';

/**
 * Settings → Privacy: per-Space "clear cookies and site data when Tarnel closes" with the sites to
 * keep, plus the optional "30 s after a site's last tab closes". Burner Spaces are always wiped.
 */
export function SiteDataOnClose() {
  const [spaces, setSpaces] = useState<SpaceSiteDataPolicy[]>([]);

  useEffect(() => {
    if (!hasBridge()) return;
    void velaPages()
      .siteData.list()
      .then(setSpaces)
      .catch(() => undefined);
  }, []);

  const save = (spaceId: string, policy: SiteDataPolicy): void => {
    setSpaces((current) => current.map((entry) => (entry.spaceId === spaceId ? { ...entry, policy } : entry)));
    void velaPages()
      .siteData.set(spaceId, policy)
      .then(setSpaces)
      .catch(() => undefined);
  };

  if (spaces.length === 0) return null;
  return (
    <>
      {spaces.map((entry) => (
        <SpacePolicy key={entry.spaceId} entry={entry} showName={spaces.length > 1} onChange={(policy) => save(entry.spaceId, policy)} />
      ))}
    </>
  );
}

function SpacePolicy({ entry, showName, onChange }: { entry: SpaceSiteDataPolicy; showName: boolean; onChange: (policy: SiteDataPolicy) => void }) {
  const exitId = useId();
  const lastTabId = useId();
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const { policy } = entry;
  const kept = Object.entries(policy.sites).filter(([, action]) => action === 'keep').map(([site]) => site).sort();
  const cleared = Object.entries(policy.sites).filter(([, action]) => action === 'clear').map(([site]) => site).sort();
  const pattern = normalizeSitePattern(draft);

  const setSite = (site: string, action: 'keep' | 'clear' | null): void => {
    const sites = { ...policy.sites };
    if (action === null) delete sites[site];
    else sites[site] = action;
    onChange({ ...policy, sites });
  };

  const add = (event: FormEvent): void => {
    event.preventDefault();
    if (!pattern) return;
    setSite(pattern, 'keep');
    setDraft('');
  };

  return (
    <Group title={showName ? `Cookies and site data · ${entry.name}` : 'Cookies and site data'}>
      <Row
        title="Clear cookies and site data when Tarnel closes"
        description="Signs you out of sites in this Space every time you quit, except the sites you keep."
        htmlFor={exitId}
      >
        <Switch id={exitId} checked={policy.clearOnExit} onCheckedChange={(checked) => onChange({ ...policy, clearOnExit: checked })} />
      </Row>
      <Row
        title="Clear a site's data after its last tab closes"
        description="30 seconds after you close the last tab of a site, its cookies and storage are deleted. Kept sites are skipped."
        htmlFor={lastTabId}
      >
        <Switch id={lastTabId} checked={policy.clearOnLastTab} onCheckedChange={(checked) => onChange({ ...policy, clearOnLastTab: checked })} />
      </Row>
      <div className="px-4 py-3">
        <label htmlFor={inputId} className="block text-[13px] leading-5 font-medium text-foreground">
          Sites that keep their data
        </label>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Includes subdomains. You can also choose per site from the lock in the address bar.</p>
        <form onSubmit={add} className="mt-2.5 flex items-center gap-2">
          <input
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="example.com"
            spellCheck={false}
            autoComplete="off"
            className="h-8 min-w-0 flex-1 rounded-lg bg-secondary px-2.5 text-[13px] text-foreground ring-1 ring-border outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          <button
            type="submit"
            disabled={!pattern}
            className="h-8 shrink-0 rounded-lg bg-secondary px-3 text-[13px] font-medium text-foreground ring-1 ring-border transition-colors duration-150 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
          >
            Add
          </button>
        </form>
        <SiteList sites={kept} empty="No sites kept." onRemove={(site) => setSite(site, null)} />
        {cleared.length > 0 && (
          <>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">Always deleted when Tarnel closes</p>
            <SiteList sites={cleared} empty="" onRemove={(site) => setSite(site, null)} />
          </>
        )}
      </div>
    </Group>
  );
}

function SiteList({ sites, empty, onRemove }: { sites: string[]; empty: string; onRemove: (site: string) => void }) {
  if (sites.length === 0) return empty ? <p className="mt-2 text-xs text-muted-foreground/70">{empty}</p> : null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {sites.map((site) => (
        <li key={site} className="flex h-7 items-center gap-1 rounded-full bg-secondary pr-1 pl-2.5 text-[12px] text-foreground ring-1 ring-border">
          {site}
          <button
            type="button"
            aria-label={`Remove ${site}`}
            onClick={() => onRemove(site)}
            className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        </li>
      ))}
    </ul>
  );
}
