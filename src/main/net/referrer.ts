import { registrableDomain } from './domain';

/**
 * Referrer trimming (Settings → Privacy → "Trim referrers"). Pure, unit-tested.
 *
 * Enforces `strict-origin-when-cross-origin` at the network layer, whatever policy the page asked
 * for (`unsafe-url`, `no-referrer-when-downgrade`, …):
 * - same-site request: the Referer is left as the page sent it;
 * - cross-site request: only the origin is sent (`https://example.com/`);
 * - https → http (downgrade): no Referer at all.
 * A stricter policy chosen by the page (origin only, or none) is never loosened: this only ever
 * shortens or drops the header.
 */

function siteOf(url: URL): string {
  return registrableDomain(url.hostname);
}

/**
 * Returns the Referer to send for a request to `requestUrl`, or null to drop the header. Returns
 * the input unchanged when there is nothing to trim (or either URL is unparseable).
 */
export function trimReferrer(referrer: string, requestUrl: string): string | null {
  if (!referrer) return referrer;
  let from: URL;
  let to: URL;
  try {
    from = new URL(referrer);
    to = new URL(requestUrl);
  } catch {
    return referrer;
  }
  if (from.protocol === 'https:' && to.protocol === 'http:') return null;
  if (from.protocol !== 'http:' && from.protocol !== 'https:') return referrer;
  if (siteOf(from) === siteOf(to)) return referrer;
  return `${from.origin}/`;
}
