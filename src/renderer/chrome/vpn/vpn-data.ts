/**
 * Mock data for the VPN preview. Nothing here talks to a network: servers, loads, pings, IPs and
 * license terms are all derived locally and deterministically. Real provider integration (MantelVPN
 * first) comes later and will replace this module.
 */

export interface VpnServer {
  id: string;
  country: string;
  countryCode: string;
  city: string;
  /** Mock load, 0–100. */
  load: number;
  /** Mock round-trip time in ms. */
  ping: number;
}

export const FASTEST_ID = 'auto';

export const SERVERS: readonly VpnServer[] = [
  { id: 'de-fra', country: 'Germany', countryCode: 'DE', city: 'Frankfurt', load: 34, ping: 12 },
  { id: 'de-ber', country: 'Germany', countryCode: 'DE', city: 'Berlin', load: 58, ping: 18 },
  { id: 'nl-ams', country: 'Netherlands', countryCode: 'NL', city: 'Amsterdam', load: 41, ping: 16 },
  { id: 'ch-zrh', country: 'Switzerland', countryCode: 'CH', city: 'Zurich', load: 22, ping: 21 },
  { id: 'se-sto', country: 'Sweden', countryCode: 'SE', city: 'Stockholm', load: 17, ping: 29 },
  { id: 'gb-lon', country: 'United Kingdom', countryCode: 'GB', city: 'London', load: 72, ping: 24 },
  { id: 'fr-par', country: 'France', countryCode: 'FR', city: 'Paris', load: 46, ping: 19 },
  { id: 'es-mad', country: 'Spain', countryCode: 'ES', city: 'Madrid', load: 29, ping: 38 },
  { id: 'us-nyc', country: 'United States', countryCode: 'US', city: 'New York', load: 63, ping: 88 },
  { id: 'us-sfo', country: 'United States', countryCode: 'US', city: 'San Francisco', load: 51, ping: 142 },
  { id: 'us-mia', country: 'United States', countryCode: 'US', city: 'Miami', load: 38, ping: 104 },
  { id: 'ca-tor', country: 'Canada', countryCode: 'CA', city: 'Toronto', load: 27, ping: 96 },
  { id: 'jp-tyo', country: 'Japan', countryCode: 'JP', city: 'Tokyo', load: 44, ping: 231 },
  { id: 'sg-sin', country: 'Singapore', countryCode: 'SG', city: 'Singapore', load: 66, ping: 178 },
  { id: 'au-syd', country: 'Australia', countryCode: 'AU', city: 'Sydney', load: 31, ping: 289 },
];

export function serverById(id: string | null): VpnServer | undefined {
  return SERVERS.find((server) => server.id === id);
}

/** Lowest ping among servers that are not crowded. */
export function fastestServer(): VpnServer {
  const candidates = SERVERS.filter((server) => server.load < 70);
  return candidates.reduce((best, server) => (server.ping < best.ping ? server : best), candidates[0] ?? SERVERS[0]!);
}

export function resolveServer(id: string): VpnServer {
  return id === FASTEST_ID ? fastestServer() : (serverById(id) ?? fastestServer());
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

export const LICENSE_PATTERN = /^MNTL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
export const LICENSE_HINT = 'MNTL-XXXX-XXXX-XXXX';

/** Uppercases and, when the text holds exactly a key's worth of characters, inserts the dashes. */
export function normalizeLicense(raw: string): string {
  const upper = raw.toUpperCase().replace(/\s+/g, '');
  const compact = upper.replace(/[^A-Z0-9]/g, '');
  const body = compact.startsWith('MNTL') ? compact.slice(4) : compact;
  if (body.length !== 12) return upper;
  return `MNTL-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

export function maskLicense(key: string): string {
  return `MNTL-••••-••••-${key.slice(-4)}`;
}

const DAY_MS = 86_400_000;
export const TERM_DAYS = 365;

/**
 * Mock license term: 365 days from a "purchase" date the key pins between 0 and 89 days before
 * activation, so the same key always shows the same expiry for a given activation.
 */
export function licenseTerm(key: string, activatedAt: number): { expiresAt: number; daysLeft: number } {
  const purchasedAt = activatedAt - (hash(key) % 90) * DAY_MS;
  const expiresAt = purchasedAt + TERM_DAYS * DAY_MS;
  const daysLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS));
  return { expiresAt, daysLeft };
}
