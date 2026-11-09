/**
 * Host permissions of an extension (manifest `host_permissions`, MV2 URL `permissions`, and origins
 * granted at runtime through chrome.permissions). Match patterns per Chrome:
 * `<all_urls>`, `<scheme>://<host>/<path>` with `*` scheme (http/https), `*` host or `*.` prefix.
 * Host access is per origin, so the path part is ignored.
 */

interface MatchPattern {
  schemes: ReadonlySet<string> | null;
  /** null = any host. */
  host: string | null;
  subdomains: boolean;
}

const WEB_SCHEMES = new Set(['http', 'https', 'ws', 'wss']);

export function parseMatchPattern(pattern: string): MatchPattern | null {
  if (pattern === '<all_urls>') return { schemes: null, host: null, subdomains: true };
  const match = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(pattern);
  if (!match) return null;
  const scheme = match[1]!.toLowerCase();
  const schemes = scheme === '*' ? WEB_SCHEMES : new Set(scheme === 'http' ? ['http', 'ws'] : scheme === 'https' ? ['https', 'wss'] : [scheme]);
  let host = match[2]!.toLowerCase().replace(/:\d+$/, '');
  if (host === '*') return { schemes, host: null, subdomains: true };
  let subdomains = false;
  if (host.startsWith('*.')) {
    subdomains = true;
    host = host.slice(2);
  }
  if (!host || host.includes('*')) return null;
  return { schemes, host, subdomains };
}

function matches(pattern: MatchPattern, scheme: string, host: string): boolean {
  if (pattern.schemes && !pattern.schemes.has(scheme)) return false;
  if (pattern.host === null) return true;
  if (host === pattern.host) return true;
  return pattern.subdomains && host.endsWith(`.${pattern.host}`);
}

export class HostAccess {
  private patterns: MatchPattern[] = [];
  private all = false;

  constructor(patterns: readonly string[] = []) {
    this.add(patterns);
  }

  add(patterns: readonly string[]): void {
    for (const raw of patterns) {
      if (typeof raw !== 'string') continue;
      const pattern = parseMatchPattern(raw);
      if (!pattern) continue;
      if (pattern.host === null && (pattern.schemes === null || [...WEB_SCHEMES].every((scheme) => pattern.schemes!.has(scheme)))) this.all = true;
      this.patterns.push(pattern);
    }
  }

  /** Whether the extension may act on `url` (a URL or an origin). */
  allows(url: string): boolean {
    if (this.all) return true;
    const schemeEnd = url.indexOf('://');
    if (schemeEnd <= 0) return false;
    const scheme = url.slice(0, schemeEnd).toLowerCase();
    let host = url.slice(schemeEnd + 3).split(/[/?#]/, 1)[0]!.toLowerCase();
    host = host.slice(host.lastIndexOf('@') + 1);
    host = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '');
    return this.patterns.some((pattern) => matches(pattern, scheme, host));
  }
}
