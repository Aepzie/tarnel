import { app, net, type IpcMainInvokeEvent, type Session } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SAFETY_IPC, type SafetyStatus } from '../../shared/ipc';
import { addWebRequestStage, STAGE_ORDER } from '../net/dispatcher';
import { getSettings, onSettingsChanged } from '../settings';
import { countPrivacyEvent } from '../privacy-report/collector';
import { BlocklistIndex, LIST_SOURCES, parseList, type ListSource, type ThreatMatch } from './lists';

/**
 * Phishing & malware protection without per-URL lookups: the blocklists in ./lists.ts are fetched
 * in bulk on start and every 6 h, cached in userData/safety and matched locally in a dispatcher
 * stage. A main-frame hit is redirected to the tarnel://error warning interstitial; a sub-frame hit
 * is cancelled. "Proceed anyway" allowlists the host until Tarnel quits.
 */

const REFRESH_MS = 6 * 60 * 60 * 1000;
const FIRST_REFRESH_DELAY_MS = 5_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_LIST_BYTES = 16 * 1024 * 1024;

interface SourceMeta {
  updatedAt: number;
  entries: number;
}

let index = new BlocklistIndex();
let meta: Record<string, SourceMeta> = {};
let enabled = true;
let refreshing: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
const allowedHosts = new Set<string>();

const cacheDir = (): string => join(app.getPath('userData'), 'safety');
const cacheFile = (source: ListSource): string => join(cacheDir(), `${source.id}.txt`);
const metaFile = (): string => join(cacheDir(), 'meta.json');

async function writeAtomic(path: string, contents: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, path);
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** Streams the list with a timeout and a hard size cap (a hostile or broken mirror can't exhaust memory). */
async function download(source: ListSource): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await net.fetch(source.url, { signal: controller.signal, cache: 'no-store', redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_LIST_BYTES) throw new Error('list too large');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_LIST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('list too large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timeout);
  }
}

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Re-parses every cached list into a fresh index (swapped in at the end, so checks never see half a list). */
async function rebuildIndex(): Promise<void> {
  const next = new BlocklistIndex();
  for (const source of LIST_SOURCES) {
    const text = await readText(cacheFile(source));
    if (text === null) continue;
    await yieldToLoop();
    next.add(source, parseList(source.format, text));
  }
  index = next;
}

async function refreshSource(source: ListSource): Promise<boolean> {
  try {
    const text = await download(source);
    const entries = parseList(source.format, text).length;
    // An empty parse means the feed changed format or served an error page: keep the old cache.
    if (entries === 0) throw new Error('no entries');
    await writeAtomic(cacheFile(source), text);
    meta[source.id] = { updatedAt: Date.now(), entries };
    return true;
  } catch (error) {
    console.warn(`[safety] ${source.id} update failed:`, error instanceof Error ? error.message : error);
    return false;
  }
}

function isStale(): boolean {
  return LIST_SOURCES.some((source) => Date.now() - (meta[source.id]?.updatedAt ?? 0) >= REFRESH_MS);
}

/** Download stale lists (or all with `force`), then rebuild. Concurrent calls share one run. */
export function refreshLists(force = false): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    await mkdir(cacheDir(), { recursive: true });
    const stale = LIST_SOURCES.filter((s) => force || Date.now() - (meta[s.id]?.updatedAt ?? 0) >= REFRESH_MS);
    const results = await Promise.all(stale.map(refreshSource));
    if (!results.some(Boolean)) return;
    await writeAtomic(metaFile(), JSON.stringify(meta));
    await rebuildIndex();
  })()
    .catch((error: unknown) => console.warn('[safety] refresh failed', error))
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function loadCache(): Promise<void> {
  const raw = await readText(metaFile());
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') meta = parsed as Record<string, SourceMeta>;
    } catch {
      meta = {};
    }
  }
  await rebuildIndex();
}

function schedule(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (!enabled) return;
  timer = setInterval(() => void refreshLists(), REFRESH_MS);
  timer.unref();
  if (isStale()) setTimeout(() => void refreshLists(), FIRST_REFRESH_DELAY_MS).unref();
}

export function initSafety(): void {
  enabled = getSettings().warnDangerousSites;
  void loadCache().finally(schedule);
  onSettingsChanged((settings) => {
    if (settings.warnDangerousSites === enabled) return;
    enabled = settings.warnDangerousSites;
    schedule();
  });
}

/** Blocklist hit for a URL, unless protection is off or the user chose to proceed to its host. */
export function checkUrl(url: string): ThreatMatch | null {
  if (!enabled || index.size === 0) return null;
  const hit = index.match(url);
  if (!hit) return null;
  try {
    if (allowedHosts.has(new URL(url).hostname)) return null;
  } catch {
    return null;
  }
  return hit;
}

/** True when any URL of a download's redirect chain is listed (used to refuse auto-open). */
export function isDangerousUrlChain(urls: readonly string[]): boolean {
  return urls.some((url) => checkUrl(url) !== null);
}

export function warningPageUrl(url: string, hit: ThreatMatch): string {
  const params = new URLSearchParams({ threat: hit.source.threat, source: hit.source.name, url });
  return `tarnel://error/?${params.toString()}`;
}

export function attachSafety(session: Session): void {
  addWebRequestStage(session, 'beforeRequest', 'safety', STAGE_ORDER.safety, (details) => {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return;
    const hit = checkUrl(details.url);
    if (!hit) return;
    countPrivacyEvent('dangerousWarned', details.webContentsId);
    if (details.resourceType === 'subFrame') return { cancel: true };
    return { redirectURL: warningPageUrl(details.url, hit) };
  });
}

function status(): SafetyStatus {
  const updated = LIST_SOURCES.map((s) => meta[s.id]?.updatedAt ?? 0).filter((t) => t > 0);
  return {
    enabled,
    entries: index.size,
    updatedAt: updated.length ? Math.max(...updated) : null,
    sources: LIST_SOURCES.map((s) => ({ name: s.name, license: s.license, entries: meta[s.id]?.entries ?? 0 })),
  };
}

type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

export function registerSafetyIpc(handlePages: PagesHandler): void {
  handlePages(SAFETY_IPC.status, () => status());
  handlePages(SAFETY_IPC.proceed, (_event, rawUrl) => {
    if (typeof rawUrl !== 'string' || rawUrl.length > 4096) throw new TypeError('Invalid url');
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('Invalid url');
    allowedHosts.add(url.hostname);
  });
}
