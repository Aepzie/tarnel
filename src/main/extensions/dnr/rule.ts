import { domainList, normalizeDomain, type DomainList } from './domains';
import { compileRegexFilter, compileUrlFilter, isValidUrlFilter, translateRegex, type CompiledPattern } from './pattern';
import {
  ACTION_TYPES,
  REQUEST_METHODS,
  RESOURCE_TYPES,
  type HeaderInfo,
  type ModifyHeaderInfo,
  type RequestMethod,
  type ResourceType,
  type Rule,
  type RuleAction,
  type RuleActionType,
} from './types';

/**
 * Rule validation (Chrome's rules, with Chrome-like error messages) and compilation into the form
 * the matcher evaluates. Pure: no Electron imports.
 */

export type RulesetKind = 'session' | 'dynamic' | 'static';

/** Precedence of actions at equal priority within one extension (lower wins). */
export const ACTION_RANK: Record<Exclude<RuleActionType, 'modifyHeaders'>, number> = {
  allow: 0,
  allowAllRequests: 1,
  block: 2,
  upgradeScheme: 3,
  redirect: 4,
};

/** Ties between rulesets of one extension: session, then dynamic, then static. */
export const RULESET_RANK: Record<RulesetKind, number> = { session: 0, dynamic: 1, static: 2 };

/** Which index key a rule is filed under (ruleset.ts). */
export const IndexKind = { Generic: 0, Host: 1, RequestDomains: 2, Token: 3, Initiator: 4, Header: 5 } as const;
export type IndexKind = (typeof IndexKind)[keyof typeof IndexKind];

export interface CompiledRule {
  id: number;
  priority: number;
  type: RuleActionType;
  action: RuleAction;
  pattern: CompiledPattern | null;
  isRegex: boolean;
  requestDomains: DomainList | null;
  excludedRequestDomains: DomainList | null;
  initiatorDomains: DomainList | null;
  excludedInitiatorDomains: DomainList | null;
  /** Bit i set = RESOURCE_TYPES[i] matches. */
  typeMask: number;
  /** Bit i set = REQUEST_METHODS[i] matches; 0 = any method. */
  methodMask: number;
  excludedMethodMask: number;
  /** 0 = any, 1 = first party only, 2 = third party only. */
  domainType: 0 | 1 | 2;
  tabIds: ReadonlySet<number> | null;
  excludedTabIds: ReadonlySet<number> | null;
  responseHeaders: HeaderInfo[] | null;
  excludedResponseHeaders: HeaderInfo[] | null;
  rulesetId: string;
  rulesetRank: number;
  /** The rule as the extension wrote it (dynamic / session rules only, for get*Rules). */
  source: Rule | null;
  indexKind: IndexKind;
  indexToken: string | null;
}

const TYPE_BIT = new Map<string, number>(RESOURCE_TYPES.map((type, index) => [type, 1 << index]));
const METHOD_BIT = new Map<string, number>(REQUEST_METHODS.map((method, index) => [method, 1 << index]));
const ALL_TYPES = (1 << RESOURCE_TYPES.length) - 1;
const MAIN_FRAME = TYPE_BIT.get('main_frame')!;
const SUB_FRAME = TYPE_BIT.get('sub_frame')!;

export function typeBit(type: ResourceType): number {
  return TYPE_BIT.get(type) ?? TYPE_BIT.get('other')!;
}

export function methodBit(method: RequestMethod): number {
  return METHOD_BIT.get(method) ?? METHOD_BIT.get('other')!;
}

/** Request headers an extension may `append` to (Chrome's allow-list). */
const APPENDABLE_REQUEST_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'access-control-request-headers',
  'cache-control',
  'connection',
  'content-language',
  'cookie',
  'forwarded',
  'if-match',
  'if-none-match',
  'keep-alive',
  'range',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
  'want-digest',
  'x-forwarded-for',
]);

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export class RuleError extends Error {}

function fail(id: unknown, message: string): never {
  throw new RuleError(`Rule with id ${typeof id === 'number' ? id : '?'} ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(id: number, key: string, value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) fail(id, `has an invalid "${key}" list.`);
  if (value.length === 0) fail(id, `must not provide an empty "${key}" list.`);
  return value as string[];
}

function domains(id: number, key: string, value: unknown): DomainList | null {
  const list = stringArray(id, key, value);
  if (!list) return null;
  let clean: string[] | null = null;
  for (let i = 0; i < list.length; i += 1) {
    const domain = normalizeDomain(list[i]!);
    if (!domain) fail(id, `specifies an incorrect value for the "${key}" key.`);
    if (domain !== list[i] && !clean) clean = list.slice(0, i);
    clean?.push(domain);
  }
  return domainList(clean ?? list);
}

function mask(id: number, key: string, value: unknown, bits: Map<string, number>): number | null {
  const list = stringArray(id, key, value);
  if (!list) return null;
  let out = 0;
  for (const entry of list) {
    const bit = bits.get(entry);
    if (bit === undefined) fail(id, `specifies an invalid value "${entry}" for "${key}".`);
    out |= bit;
  }
  return out;
}

function tabSet(id: number, key: string, value: unknown, kind: RulesetKind): ReadonlySet<number> | null {
  if (value === undefined) return null;
  if (kind !== 'session') fail(id, `specifies the "${key}" key, which is only supported for session-scoped rules.`);
  if (!Array.isArray(value) || !value.every((entry) => Number.isInteger(entry))) fail(id, `has an invalid "${key}" list.`);
  if (key === 'tabIds' && value.length === 0) fail(id, 'must not provide an empty "tabIds" list.');
  return new Set(value as number[]);
}

function headerInfos(id: number, key: string, value: unknown): HeaderInfo[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0) fail(id, `must specify a non-empty "${key}" list.`);
  return value.map((entry) => {
    if (!isObject(entry) || typeof entry.header !== 'string' || !HEADER_NAME.test(entry.header)) fail(id, `specifies an invalid header in "${key}".`);
    const values = entry.values === undefined ? undefined : stringArray(id, `${key}.values`, entry.values) ?? undefined;
    const excludedValues = entry.excludedValues === undefined ? undefined : stringArray(id, `${key}.excludedValues`, entry.excludedValues) ?? undefined;
    return { header: entry.header.toLowerCase(), values, excludedValues };
  });
}

function headerOps(id: number, key: 'requestHeaders' | 'responseHeaders', value: unknown): ModifyHeaderInfo[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) fail(id, `must specify a non-empty "${key}" list.`);
  return value.map((entry): ModifyHeaderInfo => {
    if (!isObject(entry) || typeof entry.header !== 'string' || !HEADER_NAME.test(entry.header)) fail(id, `specifies an invalid header name in "${key}".`);
    const operation = entry.operation;
    if (operation !== 'append' && operation !== 'set' && operation !== 'remove') fail(id, `specifies an invalid header operation in "${key}".`);
    const header = entry.header.toLowerCase();
    if (operation === 'remove') {
      if (entry.value !== undefined) fail(id, 'must not provide a header value for a header to be removed.');
      return { header, operation };
    }
    if (typeof entry.value !== 'string' || entry.value.length === 0) fail(id, 'must provide a value for a header to be appended/set.');
    if (operation === 'append' && key === 'requestHeaders' && !APPENDABLE_REQUEST_HEADERS.has(header)) {
      fail(id, `specifies an invalid request header to be appended: "${header}".`);
    }
    return { header, operation, value: entry.value };
  });
}

function validRedirect(id: number, raw: unknown, hasRegex: boolean): RuleAction['redirect'] {
  if (!isObject(raw)) fail(id, 'does not specify the redirect for a redirect action.');
  const keys = ['url', 'extensionPath', 'transform', 'regexSubstitution'].filter((key) => raw[key] !== undefined);
  if (keys.length !== 1) fail(id, 'does not specify a valid redirect.');
  if (raw.url !== undefined) {
    if (typeof raw.url !== 'string') fail(id, 'specifies an invalid redirect URL.');
    try {
      new URL(raw.url);
    } catch {
      fail(id, 'specifies an invalid redirect URL.');
    }
    return { url: raw.url };
  }
  if (raw.extensionPath !== undefined) {
    if (typeof raw.extensionPath !== 'string' || !raw.extensionPath.startsWith('/')) fail(id, 'specifies an invalid extension path.');
    return { extensionPath: raw.extensionPath };
  }
  if (raw.regexSubstitution !== undefined) {
    if (!hasRegex) fail(id, 'specifies a regexSubstitution without a regexFilter.');
    if (typeof raw.regexSubstitution !== 'string') fail(id, 'specifies an invalid regexSubstitution.');
    return { regexSubstitution: raw.regexSubstitution };
  }
  const transform = raw.transform;
  if (!isObject(transform)) fail(id, 'specifies an invalid transform.');
  if (transform.scheme !== undefined && !['http', 'https', 'ftp', 'chrome-extension'].includes(String(transform.scheme))) {
    fail(id, 'specifies an invalid transform scheme.');
  }
  if (transform.query !== undefined && (typeof transform.query !== 'string' || (transform.query !== '' && !transform.query.startsWith('?')))) {
    fail(id, 'specifies an invalid transform query.');
  }
  if (transform.fragment !== undefined && (typeof transform.fragment !== 'string' || (transform.fragment !== '' && !transform.fragment.startsWith('#')))) {
    fail(id, 'specifies an invalid transform fragment.');
  }
  if (transform.queryTransform !== undefined && !isObject(transform.queryTransform)) fail(id, 'specifies an invalid queryTransform.');
  return { transform: transform as NonNullable<RuleAction['redirect']>['transform'] };
}

export interface CompileOptions {
  kind: RulesetKind;
  rulesetId: string;
  /** Keep the original object (for getDynamicRules / getSessionRules). */
  keepSource: boolean;
}

/** Validate and compile one rule. Throws RuleError with Chrome's wording on invalid input. */
export function compileRule(raw: unknown, options: CompileOptions): CompiledRule {
  if (!isObject(raw)) fail(undefined, 'is not an object.');
  const id = raw.id;
  if (!Number.isInteger(id) || (id as number) < 1) fail(undefined, 'has an invalid id: it must be an integer >= 1.');
  const ruleId = id as number;
  const priority = raw.priority === undefined ? 1 : raw.priority;
  if (!Number.isInteger(priority) || (priority as number) < 1) fail(ruleId, 'has an invalid priority: it must be an integer >= 1.');

  const action = raw.action;
  if (!isObject(action) || !ACTION_TYPES.includes(action.type as RuleActionType)) fail(ruleId, 'does not specify a valid action type.');
  const type = action.type as RuleActionType;
  const condition = raw.condition === undefined ? {} : raw.condition;
  if (!isObject(condition)) fail(ruleId, 'has an invalid condition.');

  if (condition.urlFilter !== undefined && condition.regexFilter !== undefined) fail(ruleId, 'specified both urlFilter and regexFilter keys.');
  const caseSensitive = condition.isUrlFilterCaseSensitive === true;
  let pattern: CompiledPattern | null = null;
  let isRegex = false;
  if (condition.urlFilter !== undefined) {
    if (typeof condition.urlFilter !== 'string') fail(ruleId, 'has an invalid urlFilter.');
    const problem = isValidUrlFilter(condition.urlFilter);
    if (problem) fail(ruleId, `has an invalid urlFilter: ${problem}.`);
    pattern = compileUrlFilter(condition.urlFilter, caseSensitive);
  } else if (condition.regexFilter !== undefined) {
    if (typeof condition.regexFilter !== 'string') fail(ruleId, 'specified an invalid regex.');
    const translated = translateRegex(condition.regexFilter);
    if ('problem' in translated) {
      fail(ruleId, translated.problem === 'memoryLimitExceeded' ? 'specified a more complex regex than allowed as part of the "regexFilter" key.' : 'specified an invalid regex.');
    }
    pattern = compileRegexFilter(translated, caseSensitive);
    isRegex = true;
  }

  const initiators = domains(ruleId, 'initiatorDomains', condition.initiatorDomains ?? condition.domains);
  const excludedInitiators = domains(ruleId, 'excludedInitiatorDomains', condition.excludedInitiatorDomains ?? condition.excludedDomains);
  const requestDomains = domains(ruleId, 'requestDomains', condition.requestDomains);
  const excludedRequestDomains = domains(ruleId, 'excludedRequestDomains', condition.excludedRequestDomains);

  const included = mask(ruleId, 'resourceTypes', condition.resourceTypes, TYPE_BIT);
  const excluded = mask(ruleId, 'excludedResourceTypes', condition.excludedResourceTypes, TYPE_BIT);
  if (included !== null && excluded !== null && (included & excluded) !== 0) fail(ruleId, 'includes and excludes the same resource.');
  let typeMask: number;
  if (included !== null) typeMask = included & ~(excluded ?? 0);
  else if (excluded !== null) typeMask = ALL_TYPES & ~excluded;
  else typeMask = ALL_TYPES & ~MAIN_FRAME;
  if (type === 'allowAllRequests' && (included === null || (included & ~(MAIN_FRAME | SUB_FRAME)) !== 0)) {
    fail(ruleId, 'is an "allowAllRequests" rule and must specify the "resourceTypes" key. It may only include the "main_frame" and "sub_frame" resource types.');
  }

  const methods = mask(ruleId, 'requestMethods', condition.requestMethods, METHOD_BIT);
  const excludedMethods = mask(ruleId, 'excludedRequestMethods', condition.excludedRequestMethods, METHOD_BIT);
  if (methods !== null && excludedMethods !== null && (methods & excludedMethods) !== 0) fail(ruleId, 'includes and excludes the same request method.');

  let domainType: 0 | 1 | 2 = 0;
  if (condition.domainType !== undefined) {
    if (condition.domainType === 'firstParty') domainType = 1;
    else if (condition.domainType === 'thirdParty') domainType = 2;
    else fail(ruleId, 'specifies an invalid "domainType".');
  }

  const finalAction: RuleAction = { type };
  if (type === 'redirect') finalAction.redirect = validRedirect(ruleId, action.redirect, isRegex);
  if (type === 'modifyHeaders') {
    finalAction.requestHeaders = headerOps(ruleId, 'requestHeaders', action.requestHeaders);
    finalAction.responseHeaders = headerOps(ruleId, 'responseHeaders', action.responseHeaders);
    if (!finalAction.requestHeaders && !finalAction.responseHeaders) {
      fail(ruleId, 'does not specify the request or response headers to be modified.');
    }
  }

  return {
    id: ruleId,
    priority: priority as number,
    type,
    action: finalAction,
    pattern,
    isRegex,
    requestDomains,
    excludedRequestDomains,
    initiatorDomains: initiators,
    excludedInitiatorDomains: excludedInitiators,
    typeMask,
    methodMask: methods ?? 0,
    excludedMethodMask: excludedMethods ?? 0,
    domainType,
    tabIds: tabSet(ruleId, 'tabIds', condition.tabIds, options.kind),
    excludedTabIds: tabSet(ruleId, 'excludedTabIds', condition.excludedTabIds, options.kind),
    responseHeaders: headerInfos(ruleId, 'responseHeaders', condition.responseHeaders),
    excludedResponseHeaders: headerInfos(ruleId, 'excludedResponseHeaders', condition.excludedResponseHeaders),
    rulesetId: options.rulesetId,
    rulesetRank: RULESET_RANK[options.kind],
    source: options.keepSource ? (raw as unknown as Rule) : null,
    indexKind: IndexKind.Generic,
    indexToken: null,
  };
}

/** Rules that may only be added with care (Chrome's "unsafe" dynamic/session rules). */
export function isSafeRule(rule: CompiledRule): boolean {
  return rule.type === 'block' || rule.type === 'allow' || rule.type === 'allowAllRequests' || rule.type === 'upgradeScheme';
}
