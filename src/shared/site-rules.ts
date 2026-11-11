import { isValidUserAgent, USER_AGENT_MAX } from './user-agent';
import { normalizeCountry } from './vpn-route';

/**
 * Per-site rules (pure part): a trigger (host pattern) → ordered actions, applied by main at
 * top-level navigation time (src/main/site-rules). Precedence: rule > Space setting > global setting.
 *
 * Patterns:
 *  - `example.com`        exactly this host
 *  - `*.example.com`      example.com and every subdomain
 *  - `shop-*.example.*`   `*` matches any run of characters (dots included)
 *
 * When several rules match, the most specific one wins per action kind (exact > `*.domain` > other
 * wildcards; longer literal text first), so `*.google.com → VPN` and `mail.google.com → Space` combine.
 */

export const SITE_RULES_IPC = {
  list: 'pages:site-rules-list',
  save: 'pages:site-rules-save',
  test: 'pages:site-rules-test',
  draft: 'pages:site-rules-draft',
  chromeCreateFor: 'chrome:site-rules-create-for',
  notice: 'chrome-event:site-rule-notice',
} as const;

export const SITE_RULES_MAX = 200;
export const SITE_RULE_ACTIONS_MAX = 8;
export const SITE_PATTERN_MAX = 253;

export const RULE_FINGERPRINT_LEVELS = ['off', 'standard', 'strict', 'random'] as const;
export type RuleFingerprintLevel = (typeof RULE_FINGERPRINT_LEVELS)[number];

export type SiteRuleAction =
  | { kind: 'space'; spaceId: string }
  | { kind: 'vpn'; country: string }
  | { kind: 'fingerprint'; level: RuleFingerprintLevel }
  | { kind: 'userAgent'; value: string }
  | { kind: 'block' };

export type SiteRuleActionKind = SiteRuleAction['kind'];

export const SITE_RULE_ACTION_KINDS: readonly SiteRuleActionKind[] = ['space', 'vpn', 'fingerprint', 'userAgent', 'block'];

export interface SiteRule {
  id: string;
  pattern: string;
  enabled: boolean;
  actions: SiteRuleAction[];
}

/** What applies to one URL: the winning action per kind, plus every matching rule (most specific first). */
export interface SiteRuleResolution {
  host: string | null;
  matched: SiteRule[];
  space: string | null;
  vpn: string | null;
  fingerprint: RuleFingerprintLevel | null;
  userAgent: string | null;
  block: boolean;
}

/** A rule draft for "Create rule for this site…" (pattern prefilled, no actions yet). */
export interface SiteRuleDraft {
  pattern: string;
  token: number;
}

/** Notice the chrome shows briefly when a rule could not fully apply (e.g. VPN while signed out). */
export interface SiteRuleNotice {
  tabId: number;
  message: string;
}

const RULE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const PATTERN_CHARS = /^[a-z0-9.*_-]+$/;

/** Lower-cased pattern, or null. Accepts a pasted URL (`https://www.x.com/a` → `www.x.com`). */
export function normalizeSitePattern(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let pattern = raw.trim().toLowerCase();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//.exec(pattern);
  if (scheme) pattern = pattern.slice(scheme[0].length);
  pattern = pattern.split(/[/?#]/, 1)[0] ?? '';
  pattern = pattern.replace(/:\d+$/, '').replace(/\.+$/, '').replace(/\*{2,}/g, '*');
  if (!pattern || pattern.length > SITE_PATTERN_MAX || !PATTERN_CHARS.test(pattern)) return null;
  if (pattern === '*' || pattern === '*.') return null;
  if (pattern.split('.').some((label) => label.length === 0)) return null;
  return pattern;
}

/** Host of an http(s) URL (lower case, no trailing dot), else null: rules never touch internal pages. */
export function hostOfUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  return host || null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

export function patternMatches(pattern: string, host: string): boolean {
  if (!pattern.includes('*')) return host === pattern;
  if (pattern.startsWith('*.') && !pattern.slice(2).includes('*')) {
    const base = pattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  const source = pattern.split('*').map(escapeRegExp).join('.*');
  return new RegExp(`^${source}$`).test(host);
}

/** Higher = more specific. Exact hosts beat `*.domain`, which beats free wildcards; ties by literal length. */
export function patternSpecificity(pattern: string): number {
  const literal = pattern.replace(/\*/g, '').length;
  if (!pattern.includes('*')) return 2000 + literal;
  if (pattern.startsWith('*.') && !pattern.slice(2).includes('*')) return 1000 + literal;
  return literal;
}

export function resolveSiteRules(rules: readonly SiteRule[], url: string): SiteRuleResolution {
  const host = hostOfUrl(url);
  const empty: SiteRuleResolution = { host, matched: [], space: null, vpn: null, fingerprint: null, userAgent: null, block: false };
  if (!host) return empty;
  const matched = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled && patternMatches(rule.pattern, host))
    .sort((a, b) => patternSpecificity(b.rule.pattern) - patternSpecificity(a.rule.pattern) || a.index - b.index)
    .map(({ rule }) => rule);
  const result: SiteRuleResolution = { ...empty, matched };
  const seen = new Set<SiteRuleActionKind>();
  for (const rule of matched) {
    for (const action of rule.actions) {
      if (seen.has(action.kind)) continue;
      seen.add(action.kind);
      if (action.kind === 'space') result.space = action.spaceId;
      else if (action.kind === 'vpn') result.vpn = action.country;
      else if (action.kind === 'fingerprint') result.fingerprint = action.level;
      else if (action.kind === 'userAgent') result.userAgent = action.value;
      else result.block = true;
    }
  }
  return result;
}

/** True when any enabled rule changes fingerprinting (main then keeps its preload registered). */
export function rulesTouchFingerprint(rules: readonly SiteRule[]): boolean {
  return rules.some((rule) => rule.enabled && rule.actions.some((action) => action.kind === 'fingerprint' && action.level !== 'off'));
}

function cleanAction(raw: unknown): SiteRuleAction | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  switch (input.kind) {
    case 'space':
      return typeof input.spaceId === 'string' && RULE_ID.test(input.spaceId) ? { kind: 'space', spaceId: input.spaceId } : null;
    case 'vpn': {
      const country = normalizeCountry(input.country);
      return country ? { kind: 'vpn', country } : null;
    }
    case 'fingerprint':
      return RULE_FINGERPRINT_LEVELS.includes(input.level as RuleFingerprintLevel)
        ? { kind: 'fingerprint', level: input.level as RuleFingerprintLevel }
        : null;
    case 'userAgent':
      return isValidUserAgent(input.value) && input.value.trim() && input.value.length <= USER_AGENT_MAX
        ? { kind: 'userAgent', value: input.value.trim() }
        : null;
    case 'block':
      return { kind: 'block' };
    default:
      return null;
  }
}

/**
 * Validates untrusted rules (renderer input or a stored file). Throws on malformed input so a
 * broken save never silently drops rules; `lenient` (stored file) skips bad entries instead.
 */
export function cleanSiteRules(raw: unknown, lenient = false): SiteRule[] {
  if (!Array.isArray(raw) || raw.length > SITE_RULES_MAX) {
    if (lenient) return [];
    throw new TypeError('Invalid rules');
  }
  const out: SiteRule[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    const rule = cleanRule(entry);
    if (!rule || ids.has(rule.id)) {
      if (lenient) continue;
      throw new TypeError('Invalid rule');
    }
    ids.add(rule.id);
    out.push(rule);
  }
  return out;
}

function cleanRule(raw: unknown): SiteRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const pattern = normalizeSitePattern(input.pattern);
  if (typeof input.id !== 'string' || !RULE_ID.test(input.id) || !pattern) return null;
  if (!Array.isArray(input.actions) || input.actions.length > SITE_RULE_ACTIONS_MAX) return null;
  const actions: SiteRuleAction[] = [];
  for (const entry of input.actions) {
    const action = cleanAction(entry);
    if (!action) return null;
    if (actions.some((existing) => existing.kind === action.kind)) continue;
    actions.push(action);
  }
  return { id: input.id, pattern, enabled: input.enabled !== false, actions };
}

/** The pattern "Create rule for this site…" suggests: `*.` + the host without a leading `www.`. */
export function suggestPattern(url: string): string | null {
  const host = hostOfUrl(url);
  if (!host) return null;
  if (/^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return normalizeSitePattern(host);
  return normalizeSitePattern(`*.${host.replace(/^www\./, '')}`);
}
