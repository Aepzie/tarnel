/** Sync IPC from the early-scriptlet preload (src/preload/adblock-early.ts) to main (src/main/perf/adblock-early.ts). */
export const ADBLOCK_EARLY_CHANNEL = 'vela:adblock-early-scriptlets';

const MAX_URL_LENGTH = 8192;

/**
 * The page URL a frame asked scriptlets for, normalised for lookup and caching: only http(s), no
 * credentials and no fragment (cosmetic rules never depend on it). Anything else is null.
 */
export function scriptletPageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  return url.href;
}

/**
 * Remembers which frames (renderer process + frame routing id) already got their scriptlets at
 * document start, so the library's late IPC path can skip them for the same document. Bounded:
 * frames that never ask late (closed before DOMContentLoaded, subframes) age out FIFO.
 */
export class EarlyFrames {
  private readonly frames = new Map<string, true>();

  constructor(private readonly limit = 512) {}

  private static key(processId: number, frameId: number): string {
    return `${processId}:${frameId}`;
  }

  /** A new document in this frame: `served` says whether scriptlets were injected early for it. */
  record(processId: number, frameId: number, served: boolean): void {
    const key = EarlyFrames.key(processId, frameId);
    this.frames.delete(key);
    if (!served) return;
    this.frames.set(key, true);
    if (this.frames.size <= this.limit) return;
    const oldest = this.frames.keys().next().value;
    if (oldest !== undefined) this.frames.delete(oldest);
  }

  /** True once per early-served document: the late path must then drop its scripts. */
  consume(processId: number, frameId: number): boolean {
    return this.frames.delete(EarlyFrames.key(processId, frameId));
  }

  get size(): number {
    return this.frames.size;
  }
}

/** Tiny LRU for the scriptlet bundle of recently loaded page URLs (reloads, repeated embeds). */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size <= this.limit) return;
    const oldest = this.entries.keys().next().value;
    if (oldest !== undefined) this.entries.delete(oldest);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
