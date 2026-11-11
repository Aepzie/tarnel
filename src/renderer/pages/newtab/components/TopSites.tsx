import { motion } from 'motion/react';
import { useState, type MouseEvent } from 'react';
import type { SpaceColor, TopSite } from '@shared/types';
import { rise, spring, stagger } from '@/lib/motion';
import { SPACE_HEX, letterOf, velaPages } from '@/lib/vela';
import { hasBridge } from '../theme';

export interface Site {
  url: string;
  host: string;
  title: string;
  favicon: string | null;
}

const PALETTE = Object.keys(SPACE_HEX) as SpaceColor[];

function colorFor(host: string): string {
  let hash = 0;
  for (const char of host) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return SPACE_HEX[PALETTE[Math.abs(hash) % PALETTE.length]!];
}

export function toSites(raw: TopSite[]): Site[] {
  const sites: Site[] = [];
  for (const entry of raw) {
    try {
      const url = new URL(entry.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      const host = url.hostname.replace(/^www\./, '');
      const favicon = entry.favicon?.startsWith('data:image/') ? entry.favicon : null;
      sites.push({ url: url.href, host, title: entry.title.trim() || host, favicon });
    } catch {
      continue;
    }
    if (sites.length === 8) break;
  }
  return sites;
}

function Favicon({ site }: { site: Site }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const color = colorFor(site.host);
  return (
    <span className="relative flex size-8 items-center justify-center">
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center rounded-[9px] text-[15px] font-semibold transition-opacity duration-200"
        style={{
          color,
          backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
          boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 22%, transparent)`,
          opacity: loaded ? 0 : 1,
        }}
      >
        {letterOf(site.url, site.title)}
      </span>
      {site.favicon && !failed && (
        <img
          src={site.favicon}
          alt=""
          width={32}
          height={32}
          decoding="async"
          draggable={false}
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth > 1) setLoaded(true);
            else setFailed(true);
          }}
          onError={() => setFailed(true)}
          className="relative size-8 rounded-[6px] object-contain transition-[opacity,transform] duration-300 ease-out"
          style={{ opacity: loaded ? 1 : 0, transform: loaded ? 'scale(1)' : 'scale(0.85)' }}
        />
      )}
    </span>
  );
}

function Tile({ site }: { site: Site }) {
  const open = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (hasBridge()) void velaPages().navigate(site.url);
  };
  return (
    <motion.li variants={rise} className="list-none">
      <motion.a
        href={site.url}
        onClick={open}
        title={`${site.title}\n${site.url}`}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.96 }}
        transition={spring.snappy}
        className="group flex w-24 flex-col items-center gap-2 rounded-2xl px-1 pt-3 pb-2.5 outline-none transition-[background-color,box-shadow] duration-150 hover:bg-foreground/[0.045] hover:shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight)] focus-visible:shadow-[0_0_0_2px_var(--ring)]"
      >
        <span className="flex size-12 items-center justify-center rounded-[14px] bg-island shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_8px_24px_-12px_rgb(0_0_0/0.45)]">
          <Favicon site={site} />
        </span>
        <span className="w-full truncate text-center text-xs tracking-tight text-muted-foreground transition-colors duration-150 group-hover:text-foreground">
          {site.title}
        </span>
      </motion.a>
    </motion.li>
  );
}

export function TopSites({ sites }: { sites: Site[] }) {
  return (
    <motion.ul
      variants={stagger(0.035)}
      initial="hidden"
      animate="show"
      className="grid grid-cols-4 justify-items-center gap-x-3 gap-y-2 p-0"
      aria-label="Top sites"
    >
      {sites.map((site) => (
        <Tile key={site.url} site={site} />
      ))}
    </motion.ul>
  );
}
