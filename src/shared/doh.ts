/**
 * DNS-over-HTTPS presets and template validation. Pure (no electron) so main, the settings page and
 * unit tests share it.
 */

export const SECURE_DNS_MODES = ['off', 'automatic', 'cloudflare', 'quad9', 'mullvad', 'mullvad-adblock', 'nextdns', 'custom'] as const;
export type SecureDnsMode = (typeof SECURE_DNS_MODES)[number];

export const DOH_PROVIDER_TEMPLATES = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
  mullvad: 'https://dns.mullvad.net/dns-query',
  'mullvad-adblock': 'https://adblock.dns.mullvad.net/dns-query',
} as const satisfies Partial<Record<SecureDnsMode, string>>;

const MAX_TEMPLATE_LENGTH = 512;
const DNS_VARIABLE = '{?dns}';

/**
 * Returns the trimmed template when `input` is a valid DoH URI template: an https URL without
 * credentials or fragment, either plain (POST) or ending in `{?dns}` (GET, RFC 8484). Null otherwise.
 */
export function validateDohTemplate(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const template = input.trim();
  if (!template || template.length > MAX_TEMPLATE_LENGTH || /\s/.test(template)) return null;
  const base = template.endsWith(DNS_VARIABLE) ? template.slice(0, -DNS_VARIABLE.length) : template;
  if (/[{}]/.test(base)) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname) return null;
  if (url.username || url.password || url.hash || base.includes('#')) return null;
  if (base !== template && url.search) return null;
  return template;
}

/**
 * Accepts a NextDNS configuration ID ("abc123") or a NextDNS DoH URL
 * ("https://dns.nextdns.io/abc123[/device]") and returns the DoH template, or null.
 */
export function nextDnsTemplate(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (/^[a-z0-9]{1,32}$/i.test(text)) return `https://dns.nextdns.io/${text}`;
  const template = validateDohTemplate(text);
  if (!template) return null;
  const url = new URL(template.replace(DNS_VARIABLE, ''));
  if (url.hostname !== 'dns.nextdns.io' || !/^\/[a-z0-9]{1,32}(\/[\w.-]{1,64})?\/?$/i.test(url.pathname)) return null;
  return template;
}

export interface SecureDnsSettings {
  secureDns: SecureDnsMode;
  secureDnsStrict: boolean;
  secureDnsNextDns: string;
  secureDnsTemplate: string;
}

/** What gets passed to app.configureHostResolver. `servers` is empty for 'off' and 'automatic'. */
export interface HostResolverPlan {
  secureDnsMode: 'off' | 'automatic' | 'secure';
  secureDnsServers: string[];
}

/**
 * Maps the settings to a resolver plan. A provider without a usable template (empty NextDNS ID or
 * custom URL) resolves to 'off' rather than to a strict mode that would break every lookup.
 */
export function resolveSecureDns(settings: SecureDnsSettings): HostResolverPlan {
  const off: HostResolverPlan = { secureDnsMode: 'off', secureDnsServers: [] };
  switch (settings.secureDns) {
    case 'off':
      return off;
    case 'automatic':
      return { secureDnsMode: 'automatic', secureDnsServers: [] };
    default: {
      const template =
        settings.secureDns === 'nextdns'
          ? nextDnsTemplate(settings.secureDnsNextDns)
          : settings.secureDns === 'custom'
            ? validateDohTemplate(settings.secureDnsTemplate)
            : DOH_PROVIDER_TEMPLATES[settings.secureDns];
      if (!template) return off;
      return { secureDnsMode: settings.secureDnsStrict ? 'secure' : 'automatic', secureDnsServers: [template] };
    }
  }
}
