/**
 * Site info panel + "clear cookies and site data" contract shared by main (src/main/site-data.ts),
 * the chrome UI (palette site-info popover) and Settings → Privacy. Pure: no electron imports, so the
 * exception matching below is unit-tested directly.
 */

import type { SpaceId } from './types';

export const SITE_IPC = {
  info: 'chrome:site-info',
  clear: 'chrome:site-clear',
  resetPermission: 'chrome:site-reset-permission',
  setOnClose: 'chrome:site-set-on-close',
  pagesPolicies: 'pages:site-data-policies',
  pagesSetPolicy: 'pages:site-data-set-policy',
} as const;

/** What happens to a site's cookies and storage when Tarnel closes. */
export type SiteCloseAction = 'keep' | 'clear';

export interface SiteDataPolicy {
  /** Clear cookies and site data of this Space when Tarnel closes (sites marked 'keep' survive). */
  clearOnExit: boolean;
  /** Clear a site's data 30 s after its last tab in this Space closes (sites marked 'keep' survive). */
  clearOnLastTab: boolean;
  /** Per-site overrides keyed by site (registrable domain, or a host entered by the user). */
  sites: Record<string, SiteCloseAction>;
}

export const DEFAULT_SITE_DATA_POLICY: SiteDataPolicy = { clearOnExit: false, clearOnLastTab: false, sites: {} };

export type SitePermissionKey = 'media:video' | 'media:audio' | 'geolocation' | 'notifications';

export interface SitePermission {
  key: SitePermissionKey;
  allowed: boolean;
}

export interface SiteInfo {
  tabId: number;
  spaceId: SpaceId;
  spaceName: string;
  ephemeral: boolean;
  origin: string;
  host: string;
  /** Registrable domain cookies and the close policy are keyed by. */
  site: string;
  secure: boolean;
  blockedCount: number;
  cookies: number;
  /** Bytes reported by the origin's storage estimate (IndexedDB, Cache Storage, service workers); null when unknown. */
  storageBytes: number | null;
  permissions: SitePermission[];
  /** Effective action for this site when Tarnel closes. */
  onClose: SiteCloseAction;
  /** True when `onClose` comes from a per-site override rather than the Space default. */
  overridden: boolean;
}

/** A host or "example.com" typed by the user, reduced to a bare lowercase host. Null when unusable. */
export function normalizeSitePattern(input: string): string | null {
  let text = input.trim().toLowerCase();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) {
    try {
      text = new URL(text).hostname;
    } catch {
      return null;
    }
  }
  text = text.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '').split('/')[0].split(':')[0];
  if (!text || text.length > 253) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(text)) return null;
  return text;
}

/** True when `host` is `pattern` or one of its subdomains. */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/^\.+|\.+$/g, '');
  const p = pattern.toLowerCase();
  return h === p || h.endsWith(`.${p}`);
}

/** The most specific per-site override for `host`, if any. */
export function siteOverride(policy: SiteDataPolicy, host: string): SiteCloseAction | undefined {
  let best: { length: number; action: SiteCloseAction } | null = null;
  for (const [pattern, action] of Object.entries(policy.sites)) {
    if (!hostMatches(host, pattern)) continue;
    if (!best || pattern.length > best.length) best = { length: pattern.length, action };
  }
  return best?.action;
}

/** Whether `host`'s cookies and storage are deleted when Tarnel closes. */
export function clearsOnExit(policy: SiteDataPolicy, host: string): boolean {
  const override = siteOverride(policy, host);
  if (override) return override === 'clear';
  return policy.clearOnExit;
}

/** Whether `host`'s data is deleted after its last tab closes. Never for sites marked 'keep'. */
export function clearsOnLastTab(policy: SiteDataPolicy, host: string): boolean {
  return policy.clearOnLastTab && siteOverride(policy, host) !== 'keep';
}

/** Origins a kept/cleared site's storage most likely lives under (clearData matches exact origins). */
export function originVariants(site: string): string[] {
  const hosts = site.startsWith('www.') ? [site, site.slice(4)] : [site, `www.${site}`];
  return hosts.flatMap((host) => [`https://${host}`, `http://${host}`]);
}

/** Sanitizes a stored or IPC-supplied policy. */
export function cleanSiteDataPolicy(raw: unknown): SiteDataPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SITE_DATA_POLICY, sites: {} };
  const value = raw as Record<string, unknown>;
  const sites: Record<string, SiteCloseAction> = {};
  if (value.sites && typeof value.sites === 'object' && !Array.isArray(value.sites)) {
    for (const [pattern, action] of Object.entries(value.sites as Record<string, unknown>).slice(0, 1000)) {
      const host = normalizeSitePattern(pattern);
      if (host && (action === 'keep' || action === 'clear')) sites[host] = action;
    }
  }
  return { clearOnExit: value.clearOnExit === true, clearOnLastTab: value.clearOnLastTab === true, sites };
}
