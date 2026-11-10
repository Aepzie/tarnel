import type { VpnServer } from './vpn';

/**
 * Per-tab MantelVPN routing (pure part). Electron applies proxies per session, so a routed tab
 * lives in its own partition per (Space, country); these helpers decide names and servers.
 */

export interface VpnCountry {
  /** Lower-case ISO 3166-1 alpha-2, the routing key. */
  code: string;
  name: string;
  /** At least one usable server in this country. */
  available: boolean;
}

/** A routing key: two ASCII letters, lower-cased; anything else is rejected. */
export function normalizeCountry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}

/** Session key of a tab: the Space id alone, or `<space>@vpn-<cc>` while routed. */
export function routeKey(spaceId: string, country: string | null): string {
  return country ? `${spaceId}@vpn-${country}` : spaceId;
}

/** Chromium partition of a routed tab; ephemeral (Burner) Spaces stay in memory. */
export function routedPartition(spaceId: string, ephemeral: boolean, country: string): string {
  return `${ephemeral ? '' : 'persist:'}space-${spaceId}-vpn-${country}`;
}

function usable(server: VpnServer): boolean {
  return server.online && server.status !== 'full' && server.status !== 'paused' && server.status !== 'upgrading';
}

/** The server a country routes through: usable ones first, then the lowest known ping, then id. */
export function pickServer(servers: readonly VpnServer[], country: string): VpnServer | null {
  const candidates = servers.filter((server) => server.countryCode.toLowerCase() === country && usable(server));
  candidates.sort((a, b) => (a.ping ?? Number.MAX_SAFE_INTEGER) - (b.ping ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/** One entry per country in the live list, alphabetical by name. */
export function countriesOf(servers: readonly VpnServer[]): VpnCountry[] {
  const byCode = new Map<string, VpnCountry>();
  for (const server of servers) {
    const code = normalizeCountry(server.countryCode);
    if (!code) continue;
    const known = byCode.get(code);
    byCode.set(code, { code, name: known?.name ?? server.country, available: (known?.available ?? false) || usable(server) });
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
}
