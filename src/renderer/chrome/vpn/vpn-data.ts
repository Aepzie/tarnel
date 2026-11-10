import type { VpnServer } from '@shared/vpn';

/**
 * Preview data for when the Mantel API is unreachable, plus small helpers over a server list. Live
 * servers come from main (src/main/vpn) and replace SERVERS whenever a Mantel session exists.
 */

export type { VpnServer } from '@shared/vpn';

export const FASTEST_ID = 'auto';

export const SERVERS: readonly VpnServer[] = [
  { id: 'de-fra', country: 'Germany', countryCode: 'DE', city: 'Frankfurt', online: true, load: 34, ping: 12, status: null },
  { id: 'de-ber', country: 'Germany', countryCode: 'DE', city: 'Berlin', online: true, load: 58, ping: 18, status: null },
  { id: 'nl-ams', country: 'Netherlands', countryCode: 'NL', city: 'Amsterdam', online: true, load: 41, ping: 16, status: null },
  { id: 'ch-zrh', country: 'Switzerland', countryCode: 'CH', city: 'Zurich', online: true, load: 22, ping: 21, status: null },
  { id: 'se-sto', country: 'Sweden', countryCode: 'SE', city: 'Stockholm', online: true, load: 17, ping: 29, status: null },
  { id: 'gb-lon', country: 'United Kingdom', countryCode: 'GB', city: 'London', online: true, load: 72, ping: 24, status: null },
  { id: 'fr-par', country: 'France', countryCode: 'FR', city: 'Paris', online: true, load: 46, ping: 19, status: null },
  { id: 'es-mad', country: 'Spain', countryCode: 'ES', city: 'Madrid', online: true, load: 29, ping: 38, status: null },
  { id: 'us-nyc', country: 'United States', countryCode: 'US', city: 'New York', online: true, load: 63, ping: 88, status: null },
  { id: 'us-sfo', country: 'United States', countryCode: 'US', city: 'San Francisco', online: true, load: 51, ping: 142, status: null },
  { id: 'us-mia', country: 'United States', countryCode: 'US', city: 'Miami', online: true, load: 38, ping: 104, status: null },
  { id: 'ca-tor', country: 'Canada', countryCode: 'CA', city: 'Toronto', online: true, load: 27, ping: 96, status: null },
  { id: 'jp-tyo', country: 'Japan', countryCode: 'JP', city: 'Tokyo', online: true, load: 44, ping: 231, status: null },
  { id: 'sg-sin', country: 'Singapore', countryCode: 'SG', city: 'Singapore', online: true, load: 66, ping: 178, status: null },
  { id: 'au-syd', country: 'Australia', countryCode: 'AU', city: 'Sydney', online: true, load: 31, ping: 289, status: null },
];

export function serverIn(servers: readonly VpnServer[], id: string | null): VpnServer | undefined {
  return servers.find((server) => server.id === id);
}

function usable(server: VpnServer): boolean {
  return server.online && server.status === null && (server.load === null || server.load < 70);
}

/** Lowest known ping among online, uncrowded servers; first usable one when no pings are known. */
export function fastestServer(servers: readonly VpnServer[]): VpnServer | undefined {
  const candidates = servers.filter(usable);
  return candidates.reduce<VpnServer | undefined>((best, server) => {
    if (!best) return server;
    return (server.ping ?? Infinity) < (best.ping ?? Infinity) ? server : best;
  }, undefined) ?? servers[0];
}

export function resolveServer(servers: readonly VpnServer[], id: string): VpnServer | undefined {
  return id === FASTEST_ID ? fastestServer(servers) : (serverIn(servers, id) ?? fastestServer(servers));
}

/** FNV-1a, enough to derive stable mock values from a key or server id. */
export function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export function mockIp(serverId: string): string {
  const value = hash(serverId);
  return `185.${(value % 200) + 20}.${(value >>> 8) % 255}.${((value >>> 16) % 250) + 2}`;
}

const DAY_MS = 86_400_000;
export const TERM_DAYS = 365;

/** Days until the account's paid time runs out (0 when expired). */
export function accountTerm(paidUntil: string | null): { expiresAt: number; daysLeft: number } | null {
  const expiresAt = paidUntil ? Date.parse(paidUntil) : Number.NaN;
  if (Number.isNaN(expiresAt)) return null;
  return { expiresAt, daysLeft: Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS)) };
}
