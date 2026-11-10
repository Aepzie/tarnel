import type { ImportedBookmark } from '../../shared/bookmarks';

/** Milliseconds between 1601-01-01 (WebKit / Windows FILETIME epoch) and 1970-01-01. */
export const WEBKIT_EPOCH_OFFSET_MS = 11_644_473_600_000;

/** Chromium timestamps: microseconds since 1601-01-01, often serialised as a string. undefined when unset. */
export function webkitToMs(value: unknown): number | undefined {
  const micros = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(micros) || micros <= 0) return undefined;
  const ms = Math.round(micros / 1000) - WEBKIT_EPOCH_OFFSET_MS;
  return ms > 0 ? ms : undefined;
}

export function msToWebkitMs(ms: number): number {
  return ms + WEBKIT_EPOCH_OFFSET_MS;
}

const ROOTS: readonly { key: string; title: string }[] = [
  { key: 'bookmark_bar', title: 'Bookmarks bar' },
  { key: 'other', title: 'Other bookmarks' },
  { key: 'synced', title: 'Mobile bookmarks' },
];

const MAX_DEPTH = 64;

/** Only links a browser can open; drops javascript:, chrome:// and similar. */
export function importableUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length <= 8192 && /^(https?|ftp|file):/i.test(url);
}

function convert(node: unknown, depth: number): ImportedBookmark | null {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return null;
  const raw = node as Record<string, unknown>;
  const title = typeof raw.name === 'string' ? raw.name : '';
  const addedAt = webkitToMs(raw.date_added);
  if (raw.type === 'url') {
    if (!importableUrl(raw.url)) return null;
    return { title, url: raw.url, ...(addedAt ? { addedAt } : {}) };
  }
  if (raw.type !== 'folder') return null;
  const children = Array.isArray(raw.children)
    ? raw.children.map((child) => convert(child, depth + 1)).filter((child): child is ImportedBookmark => child !== null)
    : [];
  return { title, children, ...(addedAt ? { addedAt } : {}) };
}

/** Parses a Chromium `Bookmarks` file into top-level folders (bar, other, mobile); empty roots are dropped. */
export function parseChromiumBookmarks(json: string): ImportedBookmark[] {
  const parsed: unknown = JSON.parse(json.charCodeAt(0) === 0xfeff ? json.slice(1) : json);
  const roots = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).roots : null;
  if (!roots || typeof roots !== 'object') throw new Error('Not a Chromium bookmarks file');
  const out: ImportedBookmark[] = [];
  for (const { key, title } of ROOTS) {
    const folder = convert((roots as Record<string, unknown>)[key], 0);
    if (!folder?.children?.length) continue;
    out.push({ ...folder, title });
  }
  return out;
}

export function countBookmarks(nodes: readonly ImportedBookmark[]): number {
  let total = 0;
  for (const node of nodes) total += node.children ? countBookmarks(node.children) : 1;
  return total;
}
