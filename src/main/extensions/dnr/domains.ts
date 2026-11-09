/** A list of domains from a rule condition: a host matches a domain or any of its subdomains. */
export interface DomainList {
  matches(host: string): boolean;
  readonly domains: readonly string[];
}

/** Below this size a linear scan beats hashing every suffix of the host. */
const SMALL = 6;

function endsWithDomain(host: string, domain: string): boolean {
  if (host.length === domain.length) return host === domain;
  return host.length > domain.length && host.endsWith(domain) && host.charCodeAt(host.length - domain.length - 1) === 46;
}

class SmallDomainList implements DomainList {
  constructor(readonly domains: readonly string[]) {}

  matches(host: string): boolean {
    for (const domain of this.domains) if (endsWithDomain(host, domain)) return true;
    return false;
  }
}

class LargeDomainList implements DomainList {
  private readonly set: Set<string>;

  constructor(readonly domains: readonly string[]) {
    this.set = new Set(domains);
  }

  matches(host: string): boolean {
    const set = this.set;
    if (set.has(host)) return true;
    let dot = host.indexOf('.');
    while (dot >= 0) {
      if (set.has(host.slice(dot + 1))) return true;
      dot = host.indexOf('.', dot + 1);
    }
    return false;
  }
}

export function domainList(domains: readonly string[]): DomainList {
  return domains.length <= SMALL ? new SmallDomainList(domains) : new LargeDomainList(domains);
}

/** The host and each parent domain: `a.b.c` → `a.b.c`, `b.c`, `c`. */
export function hostSuffixes(host: string): string[] {
  const out = [host];
  let dot = host.indexOf('.');
  while (dot >= 0) {
    out.push(host.slice(dot + 1));
    dot = host.indexOf('.', dot + 1);
  }
  return out;
}

function isCanonical(domain: string): boolean {
  const length = domain.length;
  if (length === 0 || domain.charCodeAt(length - 1) === 46) return false;
  for (let i = 0; i < length; i += 1) {
    const code = domain.charCodeAt(i);
    if (code <= 32 || code > 127 || (code >= 65 && code <= 90)) return false;
  }
  return true;
}

/** Chrome accepts lower-case, punycode (ASCII) domains. */
export function normalizeDomain(domain: string): string | null {
  if (isCanonical(domain)) return domain;
  const clean = domain.trim().toLowerCase().replace(/\.$/, '');
  if (!clean) return null;
  for (let i = 0; i < clean.length; i += 1) if (clean.charCodeAt(i) > 127) return null;
  return clean;
}
