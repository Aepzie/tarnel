import { hostSuffixes } from './domains';
import { tokenizeUrl } from './pattern';
import { compileRule, IndexKind, RuleError, type CompiledRule, type RulesetKind } from './rule';
import type { RequestInfo } from './types';

/**
 * An indexed ruleset. Every rule is filed under ONE kind of key, chosen once at build time:
 *
 *   1. the host of a `||host^` / `||host/…` urlFilter          → byHost
 *   2. else each of its requestDomains                            → byHost
 *   3. else its rarest bounded urlFilter / regex token           → byToken
 *   4. else each of its initiatorDomains                          → byInitiator
 *   5. else                                                       → generic (tested on every request)
 *
 * A request looks up its host and parent domains, its URL tokens and its initiator's host and
 * parent domains, so only rules that can possibly match are tested. uBlock Origin Lite's default
 * rulesets leave a few dozen generic rules; a typical request tests well under a hundred rules.
 */

/** Tokens are only needed while indexing; dropping them keeps ~1 array per rule out of the heap. */
const NO_TOKENS: string[] = [];

export interface RequestKeys {
  hosts: string[];
  tokens: string[];
  initiators: string[];
}

export function requestKeys(request: RequestInfo): RequestKeys {
  return {
    hosts: hostSuffixes(request.host),
    tokens: [...new Set(tokenizeUrl(request.lowerUrl))],
    initiators: request.initiatorHost ? hostSuffixes(request.initiatorHost) : [],
  };
}

export interface RulesetStats {
  rules: number;
  invalid: number;
  regex: number;
  generic: number;
  byHost: number;
  byToken: number;
  byInitiator: number;
}

function push(map: Map<string, CompiledRule[]>, key: string, rule: CompiledRule): void {
  const list = map.get(key);
  if (list) list.push(rule);
  else map.set(key, [rule]);
}

/**
 * The lookup structure the matcher walks. An extension's session rules, dynamic rules and (all
 * enabled) static rulesets each get one: a request does one map lookup per key per index instead of
 * one per ruleset (uBlock Origin Lite ships 50+ rulesets).
 */
export class RuleIndex {
  readonly byHost = new Map<string, CompiledRule[]>();
  readonly byToken = new Map<string, CompiledRule[]>();
  readonly byInitiator = new Map<string, CompiledRule[]>();
  readonly generic: CompiledRule[] = [];
  /** Rules with a responseHeaders condition: evaluated in onHeadersReceived only. */
  readonly headerConditioned: CompiledRule[] = [];
  hasModifyHeaders = false;
  hasAllowAllRequests = false;
  size = 0;

  add(rule: CompiledRule): void {
    this.size += 1;
    if (rule.type === 'modifyHeaders') this.hasModifyHeaders = true;
    if (rule.type === 'allowAllRequests') this.hasAllowAllRequests = true;
    switch (rule.indexKind) {
      case IndexKind.Header:
        this.headerConditioned.push(rule);
        return;
      case IndexKind.Host:
        push(this.byHost, rule.pattern!.host!, rule);
        return;
      case IndexKind.RequestDomains:
        for (const domain of rule.requestDomains!.domains) push(this.byHost, domain, rule);
        return;
      case IndexKind.Token:
        push(this.byToken, rule.indexToken!, rule);
        return;
      case IndexKind.Initiator:
        for (const domain of rule.initiatorDomains!.domains) push(this.byInitiator, domain, rule);
        return;
      default:
        this.generic.push(rule);
    }
  }

  /** Call `visit` for every rule that matches the request (response-header conditions excluded). */
  forEachMatch(request: RequestInfo, keys: RequestKeys, visit: (rule: CompiledRule) => void): void {
    if (this.byHost.size > 0) for (const host of keys.hosts) check(this.byHost.get(host), request, visit);
    if (this.byToken.size > 0) for (const token of keys.tokens) check(this.byToken.get(token), request, visit);
    if (this.byInitiator.size > 0) for (const host of keys.initiators) check(this.byInitiator.get(host), request, visit);
    if (this.generic.length > 0) check(this.generic, request, visit);
  }

  /** Rules with a response-header condition that match (onHeadersReceived only). */
  forEachHeaderMatch(request: RequestInfo, visit: (rule: CompiledRule) => void): void {
    for (const rule of this.headerConditioned) {
      if (ruleMatches(rule, request) && responseHeadersMatch(rule, request.responseHeaders)) visit(rule);
    }
  }
}

function check(list: CompiledRule[] | undefined, request: RequestInfo, visit: (rule: CompiledRule) => void): void {
  if (list === undefined) return;
  for (let i = 0; i < list.length; i += 1) {
    const rule = list[i]!;
    if (ruleMatches(rule, request)) visit(rule);
  }
}

/**
 * Tokens present in a large share of all URLs. A rule is filed under one of these only when it has
 * no other key, otherwise every request would test it.
 */
const COMMON_TOKENS = new Set([
  'http', 'https', 'www', 'com', 'net', 'org', 'js', 'css', 'html', 'htm', 'php', 'png', 'jpg', 'jpeg', 'gif', 'svg',
  'webp', 'json', 'min', 'static', 'cdn', 'assets', 'img', 'images', 'image', 'api', 'v1', 'v2', 'id', 'en', 'us',
  'de', 'uk', 'io', 'co', 'index', 'wp', 'content', 'uploads', 'media', 'ads', 'ad', 'utm', 'source', 'page',
]);

/** Single-label hosts (`com`, `ru`) as index keys would be hit by every request to that TLD. */
function goodHost(host: string): boolean {
  return host.includes('.');
}

function chooseKey(rule: CompiledRule, frequency: Map<string, number>): void {
  if (rule.responseHeaders || rule.excludedResponseHeaders) {
    rule.indexKind = IndexKind.Header;
    return;
  }
  const pattern = rule.pattern;
  if (pattern?.host && goodHost(pattern.host)) {
    rule.indexKind = IndexKind.Host;
    return;
  }
  const domains = rule.requestDomains?.domains;
  if (domains && domains.every(goodHost)) {
    rule.indexKind = IndexKind.RequestDomains;
    return;
  }
  let best: string | null = null;
  let bestScore = Infinity;
  for (const token of pattern?.tokens ?? NO_TOKENS) {
    const score = (frequency.get(token) ?? 0) * (COMMON_TOKENS.has(token) ? 1000 : 1);
    if (score < bestScore || (score === bestScore && token.length > best!.length)) {
      best = token;
      bestScore = score;
    }
  }
  if (best !== null && !COMMON_TOKENS.has(best)) {
    rule.indexKind = IndexKind.Token;
    rule.indexToken = best;
    return;
  }
  if (domains) {
    rule.indexKind = IndexKind.RequestDomains;
    return;
  }
  if (rule.initiatorDomains && rule.initiatorDomains.domains.every(goodHost)) {
    rule.indexKind = IndexKind.Initiator;
    return;
  }
  if (best !== null) {
    rule.indexKind = IndexKind.Token;
    rule.indexToken = best;
    return;
  }
  if (pattern?.host) {
    rule.indexKind = IndexKind.Host;
    return;
  }
  rule.indexKind = rule.initiatorDomains ? IndexKind.Initiator : IndexKind.Generic;
}

export class Ruleset {
  readonly rules: CompiledRule[];
  /** Static rules switched off with updateStaticRules (left out when indexes are built). */
  disabled: ReadonlySet<number> = new Set();
  readonly stats: RulesetStats;

  constructor(
    readonly id: string,
    readonly kind: RulesetKind,
    rules: CompiledRule[],
    invalid = 0,
  ) {
    this.rules = rules;
    const stats: RulesetStats = { rules: rules.length, invalid, regex: 0, generic: 0, byHost: 0, byToken: 0, byInitiator: 0 };
    const frequency = new Map<string, number>();
    for (const rule of rules) for (const token of rule.pattern?.tokens ?? NO_TOKENS) frequency.set(token, (frequency.get(token) ?? 0) + 1);
    for (const rule of rules) {
      if (rule.isRegex) stats.regex += 1;
      chooseKey(rule, frequency);
      if (rule.indexKind === IndexKind.Host || rule.indexKind === IndexKind.RequestDomains) stats.byHost += 1;
      else if (rule.indexKind === IndexKind.Token) stats.byToken += 1;
      else if (rule.indexKind === IndexKind.Initiator) stats.byInitiator += 1;
      else if (rule.indexKind === IndexKind.Generic) stats.generic += 1;
      if (rule.pattern && rule.pattern.tokens.length > 0) rule.pattern.tokens = NO_TOKENS;
    }
    this.stats = stats;
  }

  get size(): number {
    return this.rules.length;
  }

  /** A fresh index over this ruleset alone (session / dynamic rules, tests). */
  get index(): RuleIndex {
    return mergeRulesets([this]);
  }
}

/** One index over several rulesets, without their disabled rules. */
export function mergeRulesets(rulesets: readonly Ruleset[]): RuleIndex {
  const index = new RuleIndex();
  for (const ruleset of rulesets) {
    const disabled = ruleset.disabled;
    for (const rule of ruleset.rules) if (disabled.size === 0 || !disabled.has(rule.id)) index.add(rule);
  }
  return index;
}

/** Build a ruleset from untrusted JSON. Static rulesets skip invalid rules (as Chrome does). */
export function buildRuleset(id: string, kind: RulesetKind, raw: unknown[], keepSource: boolean): Ruleset {
  const rules: CompiledRule[] = [];
  const seen = new Set<number>();
  let invalid = 0;
  for (const entry of raw) {
    try {
      const rule = compileRule(entry, { kind, rulesetId: id, keepSource });
      if (seen.has(rule.id)) {
        invalid += 1;
        continue;
      }
      seen.add(rule.id);
      rules.push(rule);
    } catch (error) {
      if (!(error instanceof RuleError)) throw error;
      invalid += 1;
    }
  }
  return new Ruleset(id, kind, rules, invalid);
}

function isThirdParty(request: RequestInfo): boolean {
  return request.thirdParty;
}

export function ruleMatches(rule: CompiledRule, request: RequestInfo): boolean {
  if ((rule.typeMask & request.typeBit) === 0) return false;
  if (rule.methodMask !== 0 && (rule.methodMask & request.methodBit) === 0) return false;
  if (rule.excludedMethodMask !== 0 && (rule.excludedMethodMask & request.methodBit) !== 0) return false;
  if (rule.tabIds && !rule.tabIds.has(request.tabId)) return false;
  if (rule.excludedTabIds && rule.excludedTabIds.has(request.tabId)) return false;
  if (rule.requestDomains && !rule.requestDomains.matches(request.host)) return false;
  if (rule.excludedRequestDomains && rule.excludedRequestDomains.matches(request.host)) return false;
  if (rule.initiatorDomains && (!request.initiatorHost || !rule.initiatorDomains.matches(request.initiatorHost))) return false;
  if (rule.excludedInitiatorDomains && request.initiatorHost && rule.excludedInitiatorDomains.matches(request.initiatorHost)) return false;
  if (rule.domainType !== 0 && (rule.domainType === 2) !== isThirdParty(request)) return false;
  if (rule.pattern && !(rule.pattern.hostOnly && hostKeyMatches(rule.pattern.host!, request.host)) && !rule.pattern.test(request.url, request.lowerUrl)) {
    return false;
  }
  return true;
}

function hostKeyMatches(host: string, requestHost: string): boolean {
  if (requestHost === host) return true;
  return requestHost.length > host.length && requestHost.endsWith(host) && requestHost.charCodeAt(requestHost.length - host.length - 1) === 46;
}

/** Chrome's header value globs: `*` any run, `?` any char, case-insensitive. */
function globMatches(glob: string, value: string): boolean {
  const source = glob.replace(/[.+^${}()|[\]\\/]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'i').test(value);
}

function headerValues(headers: Record<string, string[]> | undefined, name: string): string[] | null {
  if (!headers) return null;
  let out: string[] | null = null;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== name) continue;
    out ??= [];
    out.push(...headers[key]!);
  }
  return out;
}

function headerInfoMatches(info: { header: string; values?: string[]; excludedValues?: string[] }, headers: Record<string, string[]> | undefined): boolean {
  const values = headerValues(headers, info.header);
  if (!values) return false;
  if (info.excludedValues && values.some((value) => info.excludedValues!.some((glob) => globMatches(glob, value)))) return false;
  if (!info.values) return true;
  return values.some((value) => info.values!.some((glob) => globMatches(glob, value)));
}

function responseHeadersMatch(rule: CompiledRule, headers: Record<string, string[]> | undefined): boolean {
  if (rule.responseHeaders && !rule.responseHeaders.some((info) => headerInfoMatches(info, headers))) return false;
  if (rule.excludedResponseHeaders && rule.excludedResponseHeaders.some((info) => headerInfoMatches(info, headers))) return false;
  return true;
}
