import { registrableDomain } from '../net/domain';

/**
 * Dangerous-site blocklists: source definitions, parsers and the in-memory index. Pure (no
 * Electron imports) so node unit tests can load it. Every check is local — no URL ever leaves the
 * machine; the lists themselves are downloaded in bulk (see ./index.ts).
 */

export type ThreatKind = 'malware' | 'phishing' | 'badware';
export type ListFormat = 'urls' | 'hosts' | 'adblock';

export interface ListSource {
  id: string;
  /** Shown on the warning page and in Settings. */
  name: string;
  url: string;
  format: ListFormat;
  threat: ThreatKind;
  license: string;
}

export const LIST_SOURCES: readonly ListSource[] = [
  {
    id: 'urlhaus',
    name: 'URLhaus (abuse.ch)',
    url: 'https://urlhaus.abuse.ch/downloads/text_online/',
    format: 'urls',
    threat: 'malware',
    license: 'CC0 1.0',
  },
  {
    id: 'phishing-army',
    name: 'Phishing Army',
    url: 'https://phishing.army/download/phishing_army_blocklist.txt',
    format: 'hosts',
    threat: 'phishing',
    license: 'CC BY-NC 4.0',
  },
  {
    id: 'ublock-badware',
    name: 'uBlock filters – Badware risks',
    url: 'https://ublockorigin.github.io/uAssets/filters/badware.txt',
    format: 'adblock',
    threat: 'badware',
    license: 'GPL-3.0',
  },
];

const MAX_HOST_LENGTH = 253;
const MAX_URL_LENGTH = 2048;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,62})(?:\.[a-z0-9_](?:[a-z0-9_-]{0,62}))+$/;
const IGNORED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', '0.0.0.0', '127.0.0.1']);

/** Lower-cased host if it is a plausible, multi-label DNS name; null otherwise. */
export function normalizeHost(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > MAX_HOST_LENGTH || IGNORED_HOSTS.has(host)) return null;
  return HOST_RE.test(host) ? host : null;
}

/** Canonical form used for full-URL matching: parsed href without the fragment; http(s) only. */
export function normalizeUrl(raw: string): string | null {
  if (raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  return url.href;
}

function* lines(text: string): Generator<string> {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) yield trimmed;
  }
}

/** URLhaus-style list: one URL per line, `#` comments. */
export function parseUrlList(text: string): string[] {
  const out: string[] = [];
  for (const line of lines(text)) {
    if (line.startsWith('#')) continue;
    const url = normalizeUrl(line);
    if (url) out.push(url);
  }
  return out;
}

/** Plain domain list or hosts file (`0.0.0.0 domain`), `#` comments. */
export function parseHostList(text: string): string[] {
  const out: string[] = [];
  for (const line of lines(text)) {
    if (line.startsWith('#') || line.startsWith('!')) continue;
    const fields = line.replace(/#.*$/, '').trim().split(/\s+/);
    const candidate = fields.length > 1 && /^(0\.0\.0\.0|127\.0\.0\.1|::1?)$/.test(fields[0]!) ? fields[1]! : fields[0]!;
    const host = normalizeHost(candidate);
    if (host) out.push(host);
  }
  return out;
}

/**
 * Adblock-syntax list: only plain network rules that block a whole host (`||host^` with optional
 * options such as `$doc` / `$all`) are used. Exceptions, cosmetic rules, path rules and rules
 * restricted to other resource types are skipped — a safety warning must never fire on a guess.
 */
export function parseAdblockHosts(text: string): string[] {
  const out: string[] = [];
  for (const line of lines(text)) {
    if (line.startsWith('!') || line.startsWith('[') || line.startsWith('@@') || line.includes('#')) continue;
    const match = /^\|\|([^/^$*|]+)\^(?:\$(.*))?$/.exec(line);
    if (!match) continue;
    const options = match[2];
    if (options && !options.split(',').every((option) => /^(doc|document|all|important|popup|~?third-party|3p|1p)$/.test(option))) {
      continue;
    }
    const host = normalizeHost(match[1]!);
    if (host) out.push(host);
  }
  return out;
}

export function parseList(format: ListFormat, text: string): string[] {
  if (format === 'urls') return parseUrlList(text);
  if (format === 'hosts') return parseHostList(text);
  return parseAdblockHosts(text);
}

export interface ThreatMatch {
  source: ListSource;
  /** What matched: the listed host or URL. */
  entry: string;
}

/** Hosts and URLs of every loaded list, mapped to their source. */
export class BlocklistIndex {
  private readonly hosts = new Map<string, ListSource>();
  private readonly urls = new Map<string, ListSource>();

  add(source: ListSource, entries: readonly string[]): void {
    const target = source.format === 'urls' ? this.urls : this.hosts;
    for (const entry of entries) {
      if (!target.has(entry)) target.set(entry, source);
    }
  }

  get size(): number {
    return this.hosts.size + this.urls.size;
  }

  /**
   * Full-URL match (URL lists), then the host and each parent domain down to the registrable
   * domain (host lists). A listed public/shared suffix such as `github.io` never blocks its
   * subdomains, and a URL list entry never blocks the rest of its (often compromised) host.
   */
  match(rawUrl: string): ThreatMatch | null {
    const url = normalizeUrl(rawUrl);
    if (!url) return null;
    const byUrl = this.urls.get(url);
    if (byUrl) return { source: byUrl, entry: url };
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    for (const candidate of hostCandidates(host)) {
      const byHost = this.hosts.get(candidate);
      if (byHost) return { source: byHost, entry: candidate };
    }
    return null;
  }
}

/** `a.b.example.co.uk` → a.b.example.co.uk, b.example.co.uk, example.co.uk. */
export function hostCandidates(host: string): string[] {
  const out = [host];
  const floor = registrableDomain(host);
  if (!floor || floor === host || !host.endsWith(`.${floor}`)) return out;
  let rest = host;
  while (rest !== floor) {
    rest = rest.slice(rest.indexOf('.') + 1);
    out.push(rest);
  }
  return out;
}
