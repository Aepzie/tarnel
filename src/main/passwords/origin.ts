/**
 * Origins identify the site a login belongs to: scheme + host (+ non-default port). Only http(s)
 * origins can hold logins. Pure: no electron imports (unit-tested).
 */

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/** "HTTPS://Example.COM:443/login?x" → "https://example.com"; null for anything that is not http(s). */
export function normaliseOrigin(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  const port = url.port && url.port !== DEFAULT_PORTS[url.protocol] ? `:${url.port}` : '';
  return `${url.protocol}//${host}${port}`;
}

/** Host part shown in prompts ("accounts.example.com"; port kept when not default). */
export function displayHost(origin: string): string {
  return origin.replace(/^https?:\/\//, '');
}

export function isSecureOrigin(origin: string): boolean {
  if (origin.startsWith('https://')) return true;
  const host = displayHost(origin).replace(/:\d+$/, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]';
}

/** Logins are matched on the exact origin only: no subdomain or http↔https sharing. */
export function originMatches(savedOrigin: string, pageUrl: string): boolean {
  const page = normaliseOrigin(pageUrl);
  return page !== null && page === savedOrigin;
}
