import { net, type Session } from 'electron';
import { getSettings } from '../settings';
import { getActiveSpaceId, getSpace, getSpaceSession } from '../spaces';
import { getActiveTab, getTabVpn } from '../tabs';
import { isBatterySaverActive } from './battery-saver';

/**
 * Address-bar prefetch (Settings → Performance → "Preload pages from the address bar").
 *
 * When the palette's selected suggestion is a URL and the user lingers on it, the main document is
 * fetched once through the Space's own session so the navigation that usually follows finds a warm
 * connection and, when the page is cacheable, the HTTP cache already filled. Nothing is rendered and
 * no script runs (unlike Chromium prerender), so a wrong guess costs one GET.
 *
 * Deliberately conservative: GET over https only, never search results, never in a Burner Space or
 * when the active tab is routed through MantelVPN (the prefetch would leave the tunnel), at most one
 * in flight and three per minute, and capped body size. Off while battery saver is active. See docs/PERFORMANCE.md → Address-bar prefetch.
 */

/** How long the selection must rest on a suggestion before the fetch starts. */
export const PREFETCH_DWELL_MS = 150;
const MAX_PER_MINUTE = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const REPEAT_WINDOW_MS = 60_000;

const SEARCH_HOSTS = new Set([
  'duckduckgo.com',
  'www.google.com',
  'google.com',
  'search.brave.com',
  'www.startpage.com',
  'startpage.com',
  'www.ecosia.org',
  'www.bing.com',
]);

let pendingTimer: NodeJS.Timeout | null = null;
let inFlight = false;
const recentStarts: number[] = [];
const recentUrls = new Map<string, number>();

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** URLs eligible for prefetch: https (or http on loopback, for local development), not a search page. */
export function isPrefetchableUrl(url: URL): boolean {
  if (url.username || url.password) return false;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) return false;
  if (SEARCH_HOSTS.has(url.hostname)) return false;
  return true;
}

/** Sliding-window rate limit; returns true and records the start when a slot is free. */
export function takeRateSlot(starts: number[], now: number, max = MAX_PER_MINUTE): boolean {
  while (starts.length && now - starts[0] >= 60_000) starts.shift();
  if (starts.length >= max) return false;
  starts.push(now);
  return true;
}

function prefetchSession(): Session | null {
  if (!getSettings().preloadPages || isBatterySaverActive()) return null;
  const spaceId = getActiveSpaceId();
  if (getSpace(spaceId)?.ephemeral !== false) return null;
  const tabId = getActiveTab();
  if (tabId !== null && getTabVpn(tabId)) return null;
  return getSpaceSession(spaceId);
}

function run(url: URL): void {
  const ses = prefetchSession();
  if (!ses || inFlight) return;
  const now = Date.now();
  const href = url.href;
  const last = recentUrls.get(href);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return;
  if (!takeRateSlot(recentStarts, now)) return;
  for (const [key, at] of recentUrls) if (now - at >= REPEAT_WINDOW_MS) recentUrls.delete(key);
  recentUrls.set(href, now);

  ses.preconnect({ url: url.origin, numSockets: 2 });
  inFlight = true;
  let received = 0;
  const request = net.request({ method: 'GET', url: href, session: ses, useSessionCookies: true, redirect: 'follow' });
  request.setHeader('Sec-Purpose', 'prefetch');
  const timer = setTimeout(() => request.abort(), TIMEOUT_MS);
  const done = (): void => {
    clearTimeout(timer);
    inFlight = false;
  };
  request.on('response', (response) => {
    response.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_BYTES) request.abort();
    });
    response.on('end', done);
    response.on('error', done);
    response.on('aborted', done);
  });
  request.on('error', done);
  request.on('abort', done);
  request.end();
}

/**
 * Called whenever the palette selection settles on a URL (it already preconnects). Starts the
 * prefetch after the dwell; a newer selection within the dwell replaces the pending one.
 */
export function schedulePrefetch(rawUrl: string): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (!isPrefetchableUrl(url)) return;
  url.hash = '';
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    run(url);
  }, PREFETCH_DWELL_MS);
}
