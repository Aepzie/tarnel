/**
 * Cookie banner auto-reject contract shared by main (src/main/cookie-banners), the session preload
 * (src/preload/cookie-banners.ts), the site-info popover and Settings → Privacy. Pure: no electron
 * imports, so the site matching below is unit-tested directly.
 */

export const COOKIE_BANNER_IPC = {
  /** Frame → main (invoke): rules + config for this frame, or null when Vela should stay out. */
  frameInit: 'cookie-banners:frame-init',
  /** Frame → main (send): a banner was handled ({ cmp, cosmetic }). */
  frameDone: 'cookie-banners:frame-done',
  tabInfo: 'chrome:cookie-banners-tab',
  setAllowed: 'chrome:cookie-banners-set-allowed',
  pagesList: 'pages:cookie-banners-exceptions',
  pagesRemove: 'pages:cookie-banners-remove-exception',
} as const;

export interface CookieBannerTabInfo {
  /** Settings → Privacy → "Reject cookie banners". */
  enabled: boolean;
  /** Site key the exception applies to (lowercase host without "www."); null for non-web pages. */
  site: string | null;
  /** The user allowed banners on this site (exception). */
  allowed: boolean;
  /** Banners handled in this tab since its last top-level navigation. */
  handled: number;
}

export interface CookieBannerStats {
  /** Banners handled since Vela started (all Spaces, in memory only). */
  total: number;
  /** Of those, hidden only (cosmetic rule) rather than rejected by a click. */
  cosmetic: number;
  /** Per open tab, since its last top-level navigation. */
  byTab: Record<number, number>;
  /** Per site (same keys as the exceptions), since Vela started. */
  bySite: Record<string, number>;
}

export interface CookieBannerDoneReport {
  cmp: string;
  cosmetic: boolean;
}

const MAX_SITE = 253;
const SITE_RE = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*$/;

/** Exception key of a URL or host: lowercase hostname without a leading "www."; null when not a web host. */
export function siteKeyOf(input: string): string | null {
  let host = input.trim().toLowerCase();
  if (!host || host.length > 2048) return null;
  if (/^[a-z][a-z0-9+.-]*:/.test(host)) {
    try {
      const url = new URL(host);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      host = url.hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  if (host.length > MAX_SITE || !SITE_RE.test(host)) return null;
  return host;
}

/** True when `host` is an excepted site or a subdomain of one. */
export function isExcepted(host: string, exceptions: readonly string[]): boolean {
  const key = siteKeyOf(host);
  if (!key) return false;
  return exceptions.some((site) => key === site || key.endsWith(`.${site}`));
}

/** Validated, de-duplicated, sorted exception list from untrusted JSON. */
export function cleanExceptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const sites = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const key = siteKeyOf(entry);
    if (key) sites.add(key);
    if (sites.size >= 5000) break;
  }
  return [...sites].sort();
}

/** Validates the preload's done report (renderer input is untrusted). */
export function parseDoneReport(raw: unknown): CookieBannerDoneReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const { cmp, cosmetic } = raw as Record<string, unknown>;
  if (typeof cmp !== 'string' || cmp.length === 0 || cmp.length > 200) return null;
  return { cmp, cosmetic: cosmetic === true };
}
