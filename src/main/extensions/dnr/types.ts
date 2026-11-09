/**
 * chrome.declarativeNetRequest data model (the public, JSON shape extensions use) plus the
 * request description the matcher works on. Pure types and constants: no Electron imports.
 */

export const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const REQUEST_METHODS = ['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'other'] as const;
export type RequestMethod = (typeof REQUEST_METHODS)[number];

export const ACTION_TYPES = ['block', 'redirect', 'allow', 'upgradeScheme', 'modifyHeaders', 'allowAllRequests'] as const;
export type RuleActionType = (typeof ACTION_TYPES)[number];

export type HeaderOperation = 'append' | 'set' | 'remove';

export interface ModifyHeaderInfo {
  header: string;
  operation: HeaderOperation;
  value?: string;
}

export interface QueryKeyValue {
  key: string;
  value: string;
  replaceOnly?: boolean;
}

export interface URLTransform {
  scheme?: string;
  host?: string;
  port?: string;
  path?: string;
  query?: string;
  queryTransform?: { removeParams?: string[]; addOrReplaceParams?: QueryKeyValue[] };
  fragment?: string;
  username?: string;
  password?: string;
}

export interface Redirect {
  extensionPath?: string;
  transform?: URLTransform;
  url?: string;
  regexSubstitution?: string;
}

export interface RuleAction {
  type: RuleActionType;
  redirect?: Redirect;
  requestHeaders?: ModifyHeaderInfo[];
  responseHeaders?: ModifyHeaderInfo[];
}

export interface HeaderInfo {
  header: string;
  values?: string[];
  excludedValues?: string[];
}

export interface RuleCondition {
  urlFilter?: string;
  regexFilter?: string;
  isUrlFilterCaseSensitive?: boolean;
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  /** Deprecated aliases of initiatorDomains / excludedInitiatorDomains. */
  domains?: string[];
  excludedDomains?: string[];
  resourceTypes?: ResourceType[];
  excludedResourceTypes?: ResourceType[];
  requestMethods?: RequestMethod[];
  excludedRequestMethods?: RequestMethod[];
  domainType?: 'firstParty' | 'thirdParty';
  tabIds?: number[];
  excludedTabIds?: number[];
  responseHeaders?: HeaderInfo[];
  excludedResponseHeaders?: HeaderInfo[];
}

export interface Rule {
  id: number;
  priority?: number;
  action: RuleAction;
  condition: RuleCondition;
}

export interface RulesetResource {
  id: string;
  enabled: boolean;
  path: string;
}

export const DYNAMIC_RULESET_ID = '_dynamic';
export const SESSION_RULESET_ID = '_session';

/** Chrome's published limits (chrome.declarativeNetRequest constants, Chrome 128+). */
export const LIMITS = {
  GUARANTEED_MINIMUM_STATIC_RULES: 30000,
  /** Chrome shares a global pool of 300k extra static rules between extensions. */
  GLOBAL_STATIC_RULE_POOL: 300000,
  MAX_NUMBER_OF_STATIC_RULESETS: 100,
  MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50,
  MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
  MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5000,
  MAX_NUMBER_OF_SESSION_RULES: 5000,
  MAX_NUMBER_OF_UNSAFE_SESSION_RULES: 5000,
  MAX_NUMBER_OF_REGEX_RULES: 1000,
  MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL: 20,
  GETMATCHEDRULES_QUOTA_INTERVAL: 10,
  MAX_NUMBER_OF_DISABLED_STATIC_RULES: 5000,
} as const;

/** A request as the matcher sees it (built once per webRequest event by the engine). */
export interface RequestInfo {
  /** Full URL as Chromium reports it (already canonical: lower-case scheme and host). */
  url: string;
  /** Lower-cased URL, used for case-insensitive matching and tokens. */
  lowerUrl: string;
  scheme: string;
  /** Host without brackets / trailing dot, lower case. */
  host: string;
  /** Start / end offsets of the host in `url`. */
  hostStart: number;
  hostEnd: number;
  type: ResourceType;
  method: RequestMethod;
  /** Bit of `type` in RESOURCE_TYPES / of `method` in REQUEST_METHODS (see rule.ts). */
  typeBit: number;
  methodBit: number;
  /** Initiator host (lower case) or null for browser-initiated / opaque initiators. */
  initiatorHost: string | null;
  /** true when the request's site differs from the initiator's site. */
  thirdParty: boolean;
  tabId: number;
  /** Response headers, only during onHeadersReceived. */
  responseHeaders?: Record<string, string[]>;
}
