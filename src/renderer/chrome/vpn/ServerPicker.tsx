import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { CheckIcon, SearchIcon, StarIcon, ZapIcon } from 'lucide-react';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Flag } from './Flag';
import { FASTEST_ID, fastestServer, type VpnServer } from './vpn-data';
import { useVpn, vpn } from './vpn-store';

function LoadBar({ load }: { load: number }) {
  const tone = load >= 70 ? 'bg-red-400/80' : load >= 50 ? 'bg-amber-400/80' : 'bg-foreground/40';
  return (
    <span aria-hidden title={`${load}% load`} className="h-1 w-8 overflow-hidden rounded-full bg-foreground/[0.08]">
      <span className="block h-full" style={{ width: `${load}%` }}>
        <span className={cn('vpn-bar block h-full rounded-full', tone)} />
      </span>
    </span>
  );
}

const rowClass =
  'group flex h-10 w-full items-center gap-2.5 rounded-[9px] pr-1 pl-2 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-ring/60';

const selectedClass = 'bg-foreground/[0.06]';

/** Rows glide into place while filtering and fade in when a search reveals them; static on first paint. */
const FilterMotion = createContext<{ layout: boolean; enter: boolean }>({ layout: false, enter: false });

function MotionRow({ className, children, role }: { className?: string; children: ReactNode; role?: 'presentation' }) {
  const { layout, enter } = useContext(FilterMotion);
  return (
    <motion.li
      role={role}
      layout={layout ? 'position' : false}
      initial={enter ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ layout: spring.snappy, opacity: { duration: 0.14 } }}
      className={className}
    >
      {children}
    </motion.li>
  );
}

function FavoriteStar({ favorite, pops }: { favorite: boolean; pops: number }) {
  return (
    <motion.span
      key={pops}
      className="grid place-items-center"
      initial={pops > 0 ? { scale: 0.55 } : false}
      animate={{ scale: 1 }}
      transition={spring.pop}
    >
      <StarIcon className="size-3.5" strokeWidth={1.75} fill={favorite ? 'currentColor' : 'none'} />
    </motion.span>
  );
}

function ServerRow({ server, selected, favorite, showFlag }: { server: VpnServer; selected: boolean; favorite: boolean; showFlag: boolean }) {
  const [pops, setPops] = useState(0);
  return (
    <MotionRow className="relative flex items-center">
      <button
        type="button"
        data-vpn-row
        onClick={() => vpn.selectServer(server.id)}
        aria-current={selected || undefined}
        aria-label={[`${server.city}, ${server.country}`, server.ping !== null ? `${server.ping} milliseconds` : null, server.load !== null ? `${server.load}% load` : null, server.online ? null : 'offline', server.status]
          .filter(Boolean)
          .join(', ')}
        disabled={!server.online}
        className={cn(rowClass, 'pr-9 disabled:opacity-45', selected && selectedClass)}
      >
        {showFlag ? <Flag code={server.countryCode} /> : <span aria-hidden className="w-5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{server.city}</span>
        {server.load !== null && <LoadBar load={server.load} />}
        {(!server.online || server.status) && <span className="text-[10.5px] text-muted-foreground">{server.online ? server.status : 'offline'}</span>}
        <span className="w-12 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{server.ping !== null ? `${server.ping} ms` : ''}</span>
        {selected && <CheckIcon aria-hidden className="vpn-check absolute right-9 size-3.5" strokeWidth={2.25} />}
      </button>
      <button
        type="button"
        onClick={() => {
          if (!favorite) setPops((count) => count + 1);
          vpn.toggleFavorite(server.id);
        }}
        aria-label={favorite ? `Remove ${server.city} from favorites` : `Add ${server.city} to favorites`}
        aria-pressed={favorite}
        className={cn(
          'absolute right-1 grid size-7 place-items-center rounded-md outline-none transition-[color,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-ring',
          favorite ? 'text-amber-400' : 'text-muted-foreground/50 hover:text-foreground',
        )}
      >
        <FavoriteStar favorite={favorite} pops={pops} />
      </button>
    </MotionRow>
  );
}

function GroupLabel({ children, code }: { children: string; code?: string }) {
  return (
    <MotionRow role="presentation" className="flex items-center gap-2 px-2 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">
      {code && <Flag code={code} className="scale-90" />}
      {children}
    </MotionRow>
  );
}

/** Searchable server list grouped by country, with Fastest and favorites on top. Live Mantel locations or preview data. */
export function ServerPicker() {
  const state = useVpn();
  const reduce = useReducedMotion();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fastest = fastestServer(state.servers);

  useEffect(() => {
    const timer = window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(timer);
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => state.servers.filter((server) => !needle || `${server.city} ${server.country} ${server.countryCode}`.toLowerCase().includes(needle)),
    [needle, state.servers],
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
            onChange={(event) => {
              setQuery(event.target.value);
              setSearched(true);
            }}
            placeholder="Search country or city"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </label>
      </div>
      <motion.div layoutScroll ref={listRef} className="h-[380px] max-h-[calc(100vh-200px)] overflow-y-auto overscroll-contain px-1.5 pb-2 [scrollbar-gutter:stable] [scrollbar-color:color-mix(in_oklab,var(--foreground)_16%,transparent)_transparent] [scrollbar-width:thin]">
        <FilterMotion.Provider value={{ layout: searched && !reduce, enter: searched }}>
        <ul aria-label="Servers">
          {!needle && (
            <MotionRow>
              <button
                type="button"
                data-vpn-row
                onClick={() => vpn.selectServer(FASTEST_ID)}
                aria-current={state.serverId === FASTEST_ID || undefined}
                className={cn(rowClass, state.serverId === FASTEST_ID && selectedClass)}
              >
                <span className="grid w-5 shrink-0 place-items-center text-amber-500 dark:text-amber-300">
                  <ZapIcon className="size-[15px]" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-foreground">Fastest</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {fastest ? `Right now: ${fastest.city}${fastest.ping !== null ? `, ${fastest.ping} ms` : ''}` : 'No location online'}
                  </span>
                </span>
                {state.serverId === FASTEST_ID && <CheckIcon aria-hidden className="vpn-check mr-2 size-3.5" strokeWidth={2.25} />}
              </button>
            </MotionRow>
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
        </FilterMotion.Provider>
        {matches.length === 0 && <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">No servers match “{query.trim()}”.</p>}
      </motion.div>
    </div>
  );
}
