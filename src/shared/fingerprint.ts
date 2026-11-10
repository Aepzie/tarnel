/** Synchronous IPC asked by the fingerprint preload in every frame before page scripts run. */
export const FINGERPRINT_CONFIG_CHANNEL = 'vela:fingerprint-config';

/** Same, asked by the service-worker preload (answered on the worker's own ServiceWorkerMain.ipc). */
export const FINGERPRINT_WORKER_CONFIG_CHANNEL = 'vela:fingerprint-worker-config';

/**
 * What the main world patch needs. Derived in main from the space seed (never sent to pages) and
 * the frame's top-level site, so values are stable per site but differ between Spaces.
 */
export interface FingerprintConfig {
  strict: boolean;
  /** Four unsigned 32-bit words: HMAC(space seed, top-level site). Drives all noise. */
  key: number[];
  /** navigator.hardwareConcurrency. Per space, not per site (real hardware does not change per site). */
  cores: number;
  /** navigator.deviceMemory (GiB), consistent with the Device-Memory client hint. */
  memory: number;
  /** Index into the generic GPU model list for the real GPU vendor. */
  gpu: number;
  /** navigator.language(s) override (first = navigator.language); null = real. */
  languages: string[] | null;
}

/**
 * Per-Space timezone: '' = automatic (Strict: the VPN country's zone for routed tabs, else UTC;
 * Standard: the system zone), 'system', 'vpn' (the routed country's zone), or an IANA zone name.
 */
export const TIMEZONE_AUTO = '';
export const TIMEZONE_SYSTEM = 'system';
export const TIMEZONE_VPN = 'vpn';

/** Per-Space language: '' = system, else a BCP 47 tag from LANGUAGE_CHOICES. */
export const LANGUAGE_SYSTEM = '';

export const TIMEZONE_CHOICES: readonly { value: string; label: string }[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/Los_Angeles', label: 'Los Angeles' },
  { value: 'America/Denver', label: 'Denver' },
  { value: 'America/Chicago', label: 'Chicago' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'America/Toronto', label: 'Toronto' },
  { value: 'America/Mexico_City', label: 'Mexico City' },
  { value: 'America/Sao_Paulo', label: 'São Paulo' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Dublin', label: 'Dublin' },
  { value: 'Europe/Lisbon', label: 'Lisbon' },
  { value: 'Europe/Madrid', label: 'Madrid' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'Europe/Zurich', label: 'Zurich' },
  { value: 'Europe/Rome', label: 'Rome' },
  { value: 'Europe/Stockholm', label: 'Stockholm' },
  { value: 'Europe/Warsaw', label: 'Warsaw' },
  { value: 'Europe/Helsinki', label: 'Helsinki' },
  { value: 'Europe/Istanbul', label: 'Istanbul' },
  { value: 'Europe/Moscow', label: 'Moscow' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Kolkata', label: 'India' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { value: 'Asia/Shanghai', label: 'Shanghai' },
  { value: 'Asia/Seoul', label: 'Seoul' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Pacific/Auckland', label: 'Auckland' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg' },
];

export const LANGUAGE_CHOICES: readonly { value: string; label: string }[] = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'es-ES', label: 'Español' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'nl-NL', label: 'Nederlands' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'pl-PL', label: 'Polski' },
  { value: 'sv-SE', label: 'Svenska' },
  { value: 'tr-TR', label: 'Türkçe' },
  { value: 'ru-RU', label: 'Русский' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'zh-CN', label: '中文 (简体)' },
];

/** A representative IANA zone per MantelVPN country (lower-case ISO code); unknown countries → UTC. */
const COUNTRY_ZONES: Readonly<Record<string, string>> = {
  us: 'America/New_York', ca: 'America/Toronto', mx: 'America/Mexico_City', br: 'America/Sao_Paulo',
  ar: 'America/Argentina/Buenos_Aires', cl: 'America/Santiago', co: 'America/Bogota', pe: 'America/Lima',
  gb: 'Europe/London', ie: 'Europe/Dublin', pt: 'Europe/Lisbon', es: 'Europe/Madrid', fr: 'Europe/Paris',
  be: 'Europe/Brussels', nl: 'Europe/Amsterdam', lu: 'Europe/Luxembourg', de: 'Europe/Berlin', ch: 'Europe/Zurich',
  at: 'Europe/Vienna', it: 'Europe/Rome', dk: 'Europe/Copenhagen', no: 'Europe/Oslo', se: 'Europe/Stockholm',
  fi: 'Europe/Helsinki', is: 'Atlantic/Reykjavik', pl: 'Europe/Warsaw', cz: 'Europe/Prague', sk: 'Europe/Bratislava',
  hu: 'Europe/Budapest', ro: 'Europe/Bucharest', bg: 'Europe/Sofia', gr: 'Europe/Athens', rs: 'Europe/Belgrade',
  hr: 'Europe/Zagreb', si: 'Europe/Ljubljana', ee: 'Europe/Tallinn', lv: 'Europe/Riga', lt: 'Europe/Vilnius',
  ua: 'Europe/Kyiv', md: 'Europe/Chisinau', tr: 'Europe/Istanbul', ru: 'Europe/Moscow', il: 'Asia/Jerusalem',
  ae: 'Asia/Dubai', sa: 'Asia/Riyadh', za: 'Africa/Johannesburg', eg: 'Africa/Cairo', ng: 'Africa/Lagos',
  ke: 'Africa/Nairobi', in: 'Asia/Kolkata', sg: 'Asia/Singapore', my: 'Asia/Kuala_Lumpur', th: 'Asia/Bangkok',
  vn: 'Asia/Ho_Chi_Minh', id: 'Asia/Jakarta', ph: 'Asia/Manila', hk: 'Asia/Hong_Kong', tw: 'Asia/Taipei',
  cn: 'Asia/Shanghai', kr: 'Asia/Seoul', jp: 'Asia/Tokyo', au: 'Australia/Sydney', nz: 'Pacific/Auckland',
};

export function timezoneForCountry(country: string): string {
  return COUNTRY_ZONES[country.toLowerCase()] ?? 'UTC';
}

const IANA_ZONE = /^(UTC|[A-Z][A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2})$/;

/** Validates a stored/incoming timezone setting; throws on anything else. */
export function cleanTimezone(raw: unknown, fallback = TIMEZONE_AUTO): string {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'string') throw new Error('Invalid timezone');
  const value = raw.trim();
  if (value === TIMEZONE_AUTO || value === TIMEZONE_SYSTEM || value === TIMEZONE_VPN) return value;
  if (value.length > 64 || !IANA_ZONE.test(value)) throw new Error('Invalid timezone');
  return value;
}

/** Validates a language setting ('' or a BCP 47 tag like "en-US"); throws on anything else. */
export function cleanLanguage(raw: unknown, fallback = LANGUAGE_SYSTEM): string {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'string') throw new Error('Invalid language');
  const value = raw.trim();
  if (value === LANGUAGE_SYSTEM) return value;
  if (!/^[a-z]{2,3}(-[A-Z]{2}|-[A-Za-z]{4})?$/.test(value)) throw new Error('Invalid language');
  return value;
}

/**
 * The zone pages of a Space see, or null for the system zone. `country` is the MantelVPN country
 * of the tab's session (null when not routed).
 */
export function resolveTimezone(setting: string | undefined, strict: boolean, country: string | null): string | null {
  const value = setting ?? TIMEZONE_AUTO;
  if (value === TIMEZONE_SYSTEM) return null;
  if (value === TIMEZONE_AUTO) {
    if (!strict) return null;
    return country ? timezoneForCountry(country) : 'UTC';
  }
  if (value === TIMEZONE_VPN) {
    if (country) return timezoneForCountry(country);
    return strict ? 'UTC' : null;
  }
  return value;
}

/** navigator.languages for a language tag: "de-DE" → ["de-DE", "de"]; "en" → ["en"]. */
export function languageList(tag: string): string[] {
  const base = tag.split('-')[0]!;
  return base === tag ? [tag] : [tag, base];
}
