import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CheckIcon, SearchIcon, StarIcon, ZapIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Flag } from './Flag';
import { FASTEST_ID, SERVERS, fastestServer, type VpnServer } from './vpn-data';
import { useVpn, vpn } from './vpn-store';

function LoadBar({ load }: { load: number }) {
  const tone = load >= 70 ? 'bg-red-400' : load >= 50 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <span aria-hidden title={`${load}% load`} className="h-1 w-8 overflow-hidden rounded-full bg-foreground/10">
      <span className={cn('block h-full rounded-full', tone)} style={{ width: `${load}%` }} />
    </span>
  );
}

const rowClass =
  'group flex h-10 w-full items-center gap-2.5 rounded-[9px] pr-1 pl-2 text-left outline-none transition-colors duration-100 hover:bg-accent focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-ring/60';

function ServerRow({ server, selected, favorite, showFlag }: { server: VpnServer; selected: boolean; favorite: boolean; showFlag: boolean }) {
  return (
    <li className="relative flex items-center">
      <button
        type="button"
        data-vpn-row
        onClick={() => vpn.selectServer(server.id)}
        aria-current={selected || undefined}
        aria-label={`${server.city}, ${server.country}, ${server.ping} milliseconds, ${server.load}% load`}
        className={cn(rowClass, 'pr-9', selected && 'bg-space/10')}
      >
        {showFlag ? <Flag code={server.countryCode} /> : <span aria-hidden className="w-5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{server.city}</span>
        <LoadBar load={server.load} />
        <span className="w-12 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{server.ping} ms</span>
        {selected && <CheckIcon aria-hidden className="absolute right-9 size-3.5 text-space" strokeWidth={2.25} />}
      </button>
      <button
        type="button"
        onClick={() => vpn.toggleFavorite(server.id)}
        aria-label={favorite ? `Remove ${server.city} from favorites` : `Add ${server.city} to favorites`}
        aria-pressed={favorite}
        className={cn(
          'absolute right-1 grid size-7 place-items-center rounded-md outline-none transition-[color,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-ring',
          favorite ? 'text-amber-400' : 'text-muted-foreground/60 hover:text-foreground',
        )}
      >
        <StarIcon className="size-3.5" strokeWidth={1.75} fill={favorite ? 'currentColor' : 'none'} />
      </button>
    </li>
  );
}

function GroupLabel({ children, code }: { children: string; code?: string }) {
  return (
    <li role="presentation" className="flex items-center gap-2 px-2 pt-2.5 pb-1 text-[11px] font-medium text-muted-foreground">
      {code && <Flag code={code} className="scale-90" />}
      {children}
    </li>
  );
}

/** Searchable server list grouped by country, with Fastest and favorites on top. Mock data. */
export function ServerPicker() {
  const state = useVpn();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fastest = fastestServer();

  useEffect(() => {
    const timer = window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(timer);
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => SERVERS.filter((server) => !needle || `${server.city} ${server.country} ${server.countryCode}`.toLowerCase().includes(needle)),
    [needle],
  );
  const groups = useMemo(() => {
    const byCountry = new Map<string, VpnServer[]>();
    for (const server of matches) byCountry.set(server.country, [...(byCountry.get(server.country) ?? []), server]);
    return [...byCountry.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [matches]);
  const favorites = matches.filter((server) => state.favorites.includes(server.id));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-vpn-row]') ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1) : index <= 0 ? -1 : index - 1;
    if (next === -1) searchRef.current?.focus();
    else rows[next]?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="p-3 pb-1.5">
        <label className="flex h-9 items-center gap-2 rounded-[10px] bg-foreground/[0.05] px-2.5 ring-1 ring-foreground/10 ring-inset focus-within:ring-2 focus-within:ring-space/60">
          <SearchIcon aria-hidden className="size-[15px] text-muted-foreground" strokeWidth={1.75} />
          <span className="sr-only">Search servers</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search country or city"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </label>
      </div>
      <div ref={listRef} className="h-[380px] max-h-[calc(100vh-200px)] overflow-y-auto overscroll-contain px-1.5 pb-2 [scrollbar-gutter:stable] [scrollbar-color:color-mix(in_oklab,var(--foreground)_16%,transparent)_transparent] [scrollbar-width:thin]">
        <ul aria-label="Servers">
          {!needle && (
            <li>
              <button
                type="button"
                data-vpn-row
                onClick={() => vpn.selectServer(FASTEST_ID)}
                aria-current={state.serverId === FASTEST_ID || undefined}
                className={cn(rowClass, state.serverId === FASTEST_ID && 'bg-space/10')}
              >
                <span className="grid w-5 shrink-0 place-items-center text-amber-500 dark:text-amber-300">
                  <ZapIcon className="size-[15px]" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-foreground">Fastest</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    Right now: {fastest.city}, {fastest.ping} ms
                  </span>
                </span>
                {state.serverId === FASTEST_ID && <CheckIcon aria-hidden className="mr-2 size-3.5 text-space" strokeWidth={2.25} />}
              </button>
            </li>
          )}
          {favorites.length > 0 && (
            <>
              <GroupLabel>Favorites</GroupLabel>
              {favorites.map((server) => (
                <ServerRow key={`fav-${server.id}`} server={server} selected={state.serverId === server.id} favorite showFlag />
              ))}
            </>
          )}
          {groups.map(([country, servers]) => (
            <li key={country} className="contents">
              <ul aria-label={country}>
                <GroupLabel code={servers[0]?.countryCode}>{country}</GroupLabel>
                {servers.map((server) => (
                  <ServerRow key={server.id} server={server} selected={state.serverId === server.id} favorite={state.favorites.includes(server.id)} showFlag={false} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {matches.length === 0 && <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">No servers match “{query.trim()}”.</p>}
      </div>
    </div>
  );
}
