/**
 * Tracking-parameter removal (Settings → Privacy → "Remove tracking parameters").
 *
 * A curated, ClearURLs-style list: only parameters that exist purely to attribute a click or a share
 * are removed, so no page ever loses state it needs. Affiliate/referral parameters that keep a page
 * working or pay a creator (Amazon `tag`, `ref` on most sites, `aff_id`, …) are deliberately kept.
 * Rationale per entry lives in docs/ARCHITECTURE.md ("Tracking parameters").
 *
 * Pure (no Electron), used by the main-frame webRequest stage (privacy.ts), "Copy link address" and
 * the omnibox. The untouched parts of the URL (other parameters, their order and encoding, the
 * fragment) are kept byte for byte, and a URL with nothing to remove is returned unchanged, so the
 * result is idempotent: cleaning a cleaned URL changes nothing (no redirect loops).
 */

/** Removed on every site. */
const GLOBAL_PARAMS: ReadonlySet<string> = new Set([
  // Google Ads / Analytics click ids
  'gclid', 'dclid', 'gbraid', 'wbraid', 'gclsrc', '_gl',
  // Meta
  'fbclid',
  // Microsoft Ads
  'msclkid',
  // Yandex
  'yclid', '_openstat',
  // Mailchimp
  'mc_eid', 'mc_cid',
  // Instagram share ids (also show up on links copied out of the app)
  'igshid', 'igsh',
  // HubSpot
  '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking',
  // Marketo
  'mkt_tok',
  // TikTok / Twitter ad click ids
  'ttclid', 'twclid',
  // Matomo / Piwik campaign tracking
  'pk_campaign', 'pk_kwd', 'pk_source', 'pk_medium', 'pk_content',
]);

/** Removed on every site when the name starts with one of these. */
const GLOBAL_PREFIXES: readonly string[] = ['utm_', 'oly_', 'vero_'];

/** Removed only on these registrable domains (host or any subdomain). */
const SITE_PARAMS: readonly { domains: readonly string[]; params: ReadonlySet<string> }[] = [
  // Twitter / X: embed + share attribution (`?s=20&t=…` on shared posts).
  { domains: ['twitter.com', 'x.com'], params: new Set(['ref_src', 'ref_url', 's', 't']) },
  // Spotify / YouTube share ids.
  { domains: ['spotify.com', 'youtube.com', 'youtu.be'], params: new Set(['si']) },
  { domains: ['youtube.com', 'youtu.be'], params: new Set(['pp', 'feature']) },
  // Amazon recommendation-widget tracking (the affiliate `tag` is kept on purpose).
  {
    domains: ['amazon.com', 'amazon.de', 'amazon.co.uk', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.ca', 'amazon.co.jp', 'amazon.com.au', 'amazon.in'],
    params: new Set(['pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pd_rd_i', 'pf_rd_p', 'pf_rd_r', 'pf_rd_s', 'pf_rd_t', 'pf_rd_i', 'pf_rd_m', 'content-id', 'ref_', '_encoding']),
  },
  // LinkedIn tracking ids.
  { domains: ['linkedin.com'], params: new Set(['trk', 'trackingid', 'lipi', 'licu']) },
  // TikTok share attribution.
  { domains: ['tiktok.com'], params: new Set(['_r', '_t', 'is_from_webapp', 'sender_device', 'is_copy_url']) },
  // Reddit share ids.
  { domains: ['reddit.com'], params: new Set(['share_id', 'rdt']) },
  // Facebook outbound-link tracking.
  { domains: ['facebook.com'], params: new Set(['__tn__', '__cft__[0]', 'mibextid']) },
];

export interface CleanResult {
  url: string;
  /** Names of the removed parameters (lower-cased), in URL order; empty when nothing changed. */
  removed: string[];
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function siteParamsFor(host: string): ReadonlySet<string>[] {
  const sets: ReadonlySet<string>[] = [];
  for (const rule of SITE_PARAMS) {
    if (rule.domains.some((domain) => matchesDomain(host, domain))) sets.push(rule.params);
  }
  return sets;
}

/** True when the (decoded, lower-cased) parameter name is tracking on `host`. */
export function isTrackingParam(name: string, host: string): boolean {
  const key = name.toLowerCase();
  if (GLOBAL_PARAMS.has(key)) return true;
  if (GLOBAL_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  return siteParamsFor(host.toLowerCase()).some((set) => set.has(key));
}

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/**
 * Removes tracking parameters from an http(s) URL. Anything that is not an absolute http(s) URL is
 * returned unchanged.
 */
export function cleanUrl(url: string): CleanResult {
  const unchanged: CleanResult = { url, removed: [] };
  if (!/^https?:\/\//i.test(url)) return unchanged;
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return unchanged;
  const hashStart = url.indexOf('#');
  if (hashStart >= 0 && hashStart < queryStart) return unchanged;

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return unchanged;
  }

  const base = url.slice(0, queryStart);
  const query = hashStart >= 0 ? url.slice(queryStart + 1, hashStart) : url.slice(queryStart + 1);
  const hash = hashStart >= 0 ? url.slice(hashStart) : '';

  const removed: string[] = [];
  const kept: string[] = [];
  for (const part of query.split('&')) {
    if (part === '') continue;
    const equals = part.indexOf('=');
    const name = decodeName(equals >= 0 ? part.slice(0, equals) : part);
    if (isTrackingParam(name, host)) removed.push(name.toLowerCase());
    else kept.push(part);
  }
  if (removed.length === 0) return unchanged;
  return { url: `${base}${kept.length > 0 ? `?${kept.join('&')}` : ''}${hash}`, removed };
}

/** Convenience: the cleaned URL string. */
export function cleanUrlString(url: string): string {
  return cleanUrl(url).url;
}
