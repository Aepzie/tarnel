import type { Session } from 'electron';
import { createStore, type JsonStore } from './store';

interface CachedFavicon {
  /** data: URL */
  data: string;
  at: number;
}

type FaviconFile = Record<string, CachedFavicon>;

const MAX_HOSTS = 300;
const MAX_BYTES = 64 * 1024;
const FRESH_MS = 7 * 86_400_000;
const FETCH_TIMEOUT_MS = 10_000;

let store: JsonStore<FaviconFile> | null = null;
/** Hosts fetched (or being fetched) this run — each favicon is requested at most once per run. */
const attempted = new Set<string>();

function getStore(): JsonStore<FaviconFile> {
  if (!store) store = createStore<FaviconFile>('favicons', {});
  return store;
}

/** Same normalisation as history (lowercase, no leading "www."). */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return normalizeHost(parsed.hostname);
  } catch {
    return null;
  }
}

function save(host: string, data: string): void {
  getStore().update((current) => {
    const next: FaviconFile = { ...current, [host]: { data, at: Date.now() } };
    const hosts = Object.keys(next);
    if (hosts.length > MAX_HOSTS) {
      hosts
        .sort((a, b) => next[a]!.at - next[b]!.at)
        .slice(0, hosts.length - MAX_HOSTS)
        .forEach((h) => delete next[h]);
    }
    return next;
  });
}

async function download(faviconUrl: string, session: Session): Promise<string | null> {
  const response = await session.fetch(faviconUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    credentials: 'omit',
    redirect: 'follow',
  });
  if (!response.ok) return null;
  const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!type.startsWith('image/')) return null;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
  return `data:${type};base64,${bytes.toString('base64')}`;
}

/**
 * Caches the favicon of `pageUrl`'s host. Only call for persistent spaces; the fetch goes through
 * the space's own session so proxy settings apply.
 */
export function rememberFavicon(pageUrl: string, faviconUrl: string, session: Session): void {
  const host = hostOf(pageUrl);
  if (!host || !/^https?:\/\//i.test(faviconUrl) || attempted.has(host)) return;
  const cached = getStore().get()[host];
  if (cached && Date.now() - cached.at < FRESH_MS) return;
  attempted.add(host);
  download(faviconUrl, session)
    .then((data) => {
      if (data) save(host, data);
    })
    .catch(() => undefined);
}

export function faviconFor(host: string): string | undefined {
  return getStore().get()[normalizeHost(host)]?.data;
}

export function clearFavicons(): void {
  attempted.clear();
  getStore().set({});
}
