import { applyRequestHeaderOps, applyResponseHeaderOps, type HeaderOpEntry } from './headers';
import { redirectUrl } from './redirect';
import { ACTION_RANK, type CompiledRule } from './rule';
import { requestKeys, type RequestKeys, type RuleIndex } from './ruleset';
import type { RequestInfo } from './types';

/**
 * Rule evaluation across the rulesets of one extension and across extensions, following Chrome's
 * declarativeNetRequest precedence:
 *
 * Within one extension, the matching rule with the highest priority wins; at equal priority
 * allow > allowAllRequests > block > upgradeScheme > redirect, and session > dynamic > static.
 * An allowAllRequests rule matched by a frame's navigation acts, for every request of that frame
 * and its child frames, like an allow rule with the same priority.
 *
 * Across extensions: block beats redirect / upgradeScheme, which beat allow; at the same level the
 * most recently installed extension wins.
 *
 * modifyHeaders: every extension's modifyHeaders rules whose priority is above its highest matching
 * allow / allowAllRequests priority apply, most recently installed extension first and higher
 * priority first; conflicting operations on one header are resolved in headers.ts.
 *
 * Pure: no Electron imports. The engine supplies the extension list and host-permission checks.
 */

export interface ExtensionRules {
  extensionId: string;
  /** Higher = installed more recently. */
  installRank: number;
  /** Session, dynamic and merged static rules (any order: ties use rulesetRank). */
  indexes: RuleIndex[];
  /** 'all' = every action without host access (declarativeNetRequest); 'host' = only with host access. */
  permission: 'all' | 'host';
  /** Whether the extension has host access to a URL (or origin host). */
  hasHostAccess(url: string): boolean;
}

export type BeforeRequestOutcome =
  | { kind: 'block'; rule: CompiledRule; extension: ExtensionRules }
  | { kind: 'redirect'; url: string; rule: CompiledRule; extension: ExtensionRules }
  | { kind: 'allow'; rule: CompiledRule | null; extension: ExtensionRules };

const CROSS_RANK = { block: 3, redirect: 2, allow: 1 } as const;

/** Per-extension allowAllRequests priority inherited from the request's frame (0 = none). */
export type FrameAllowance = (extensionId: string) => number;

const NO_FRAME: FrameAllowance = () => 0;

function needsHostAccess(rule: CompiledRule, extension: ExtensionRules): boolean {
  return extension.permission === 'host' || rule.type === 'redirect' || rule.type === 'modifyHeaders';
}

function permitted(rule: CompiledRule, extension: ExtensionRules, request: RequestInfo, initiatorUrl: string | null): boolean {
  if (!needsHostAccess(rule, extension)) return true;
  if (!extension.hasHostAccess(request.url)) return false;
  return !initiatorUrl || extension.hasHostAccess(initiatorUrl);
}

/** true when `a` beats `b` inside one extension. */
function better(a: CompiledRule, b: CompiledRule | null): boolean {
  if (!b) return true;
  if (a.priority !== b.priority) return a.priority > b.priority;
  const rankA = ACTION_RANK[a.type as keyof typeof ACTION_RANK];
  const rankB = ACTION_RANK[b.type as keyof typeof ACTION_RANK];
  if (rankA !== rankB) return rankA < rankB;
  return a.rulesetRank < b.rulesetRank;
}

interface ExtensionVerdict {
  /** Winning non-modifyHeaders rule (after applicability checks). */
  winner: CompiledRule | null;
  /** Redirect target of the winner, if it is a redirect / upgrade. */
  redirect: string | null;
  /** Highest matching allow / allowAllRequests priority (incl. the frame's), 0 = none. */
  allowCeiling: number;
  /** Matching modifyHeaders rules (unsorted). */
  modify: CompiledRule[];
  /** Highest-priority allowAllRequests rule matched by this request (frame navigations). */
  allowAll: CompiledRule | null;
}

export function evaluateExtension(
  extension: ExtensionRules,
  request: RequestInfo,
  keys: RequestKeys,
  initiatorUrl: string | null,
  frameAllowance: number,
  phase: 'request' | 'headers',
): ExtensionVerdict {
  let winner: CompiledRule | null = null;
  let redirect: string | null = null;
  let allowCeiling = frameAllowance;
  let allowAll: CompiledRule | null = null;
  const modify: CompiledRule[] = [];
  const visit = (rule: CompiledRule): void => {
    if (!permitted(rule, extension, request, initiatorUrl)) return;
    if (rule.type === 'modifyHeaders') {
      modify.push(rule);
      return;
    }
    if (rule.type === 'allow' || rule.type === 'allowAllRequests') {
      if (rule.priority > allowCeiling) allowCeiling = rule.priority;
      if (rule.type === 'allowAllRequests' && (!allowAll || rule.priority > allowAll.priority)) allowAll = rule;
    }
    if (!better(rule, winner)) return;
    if (rule.type === 'upgradeScheme' || rule.type === 'redirect') {
      const target = redirectUrl(rule, request, extension.extensionId);
      if (!target) return;
      redirect = target;
    } else {
      redirect = null;
    }
    winner = rule;
  };
  for (const index of extension.indexes) {
    index.forEachMatch(request, keys, visit);
    if (phase === 'headers' && index.headerConditioned.length > 0) index.forEachHeaderMatch(request, visit);
  }
  const final = winner as CompiledRule | null;
  if (final && frameAllowance > 0 && final.type !== 'allow' && final.type !== 'allowAllRequests' && final.priority <= frameAllowance) {
    return { winner: null, redirect: null, allowCeiling, modify, allowAll };
  }
  return { winner: final, redirect, allowCeiling, modify, allowAll };
}

export interface RequestEvaluation {
  outcome: BeforeRequestOutcome | null;
  /** extensionId → allowAllRequests priority matched by this (frame) request. */
  allowAll: Map<string, number>;
}

/** onBeforeRequest: the action to take (block / redirect / nothing). */
export function evaluateBeforeRequest(
  extensions: readonly ExtensionRules[],
  request: RequestInfo,
  initiatorUrl: string | null,
  frameAllowance: FrameAllowance = NO_FRAME,
  keys: RequestKeys = requestKeys(request),
): RequestEvaluation {
  let outcome: BeforeRequestOutcome | null = null;
  let outcomeRank = 0;
  let outcomeInstall = -Infinity;
  const allowAll = new Map<string, number>();
  for (const extension of extensions) {
    const verdict = evaluateExtension(extension, request, keys, initiatorUrl, frameAllowance(extension.extensionId), 'request');
    if (verdict.allowAll) allowAll.set(extension.extensionId, verdict.allowAll.priority);
    const rule = verdict.winner;
    if (!rule) continue;
    let candidate: BeforeRequestOutcome;
    if (rule.type === 'block') candidate = { kind: 'block', rule, extension };
    else if (rule.type === 'redirect' || rule.type === 'upgradeScheme') candidate = { kind: 'redirect', url: verdict.redirect!, rule, extension };
    else candidate = { kind: 'allow', rule, extension };
    const rank = CROSS_RANK[candidate.kind];
    if (rank > outcomeRank || (rank === outcomeRank && extension.installRank > outcomeInstall)) {
      outcome = candidate;
      outcomeRank = rank;
      outcomeInstall = extension.installRank;
    }
  }
  return { outcome, allowAll };
}

export interface HeaderEvaluation {
  /** A rule with a responseHeaders condition blocked the response. */
  block: { rule: CompiledRule; extension: ExtensionRules } | null;
  applied: { rule: CompiledRule; extension: ExtensionRules }[];
}

/** Applicable modifyHeaders rules, highest priority first (a rule filed under two keys counts once). */
function sortedModify(verdict: ExtensionVerdict): CompiledRule[] {
  return verdict.modify
    .filter((rule) => rule.priority > verdict.allowCeiling)
    .sort((a, b) => b.priority - a.priority || a.rulesetRank - b.rulesetRank || a.id - b.id)
    .filter((rule, index, list) => index === 0 || rule !== list[index - 1]);
}

/**
 * onBeforeSendHeaders / onHeadersReceived: apply modifyHeaders rules to `headers` in place.
 * Request headers use a flat map (Electron's requestHeaders), response headers a multi-map.
 */
export function evaluateHeaders(
  extensions: readonly ExtensionRules[],
  request: RequestInfo,
  initiatorUrl: string | null,
  target: { kind: 'request'; headers: Record<string, string> } | { kind: 'response'; headers: Record<string, string[]> },
  frameAllowance: FrameAllowance = NO_FRAME,
): HeaderEvaluation {
  const keys = requestKeys(request);
  const ordered = [...extensions].sort((a, b) => b.installRank - a.installRank);
  const ops: HeaderOpEntry[] = [];
  const applied: HeaderEvaluation['applied'] = [];
  let block: HeaderEvaluation['block'] = null;
  for (const extension of ordered) {
    const verdict = evaluateExtension(extension, request, keys, initiatorUrl, frameAllowance(extension.extensionId), target.kind === 'response' ? 'headers' : 'request');
    if (target.kind === 'response' && verdict.winner?.type === 'block') block ??= { rule: verdict.winner, extension };
    for (const rule of sortedModify(verdict)) {
      const list = target.kind === 'request' ? rule.action.requestHeaders : rule.action.responseHeaders;
      if (!list) continue;
      applied.push({ rule, extension });
      for (const op of list) ops.push({ extensionId: extension.extensionId, op });
    }
  }
  if (block) return { block, applied: [] };
  if (ops.length > 0) {
    if (target.kind === 'request') applyRequestHeaderOps(target.headers, ops);
    else applyResponseHeaderOps(target.headers, ops);
  }
  return { block: null, applied };
}

/** Whether any of the extensions can modify headers at all (skip header phases otherwise). */
export function anyModifyHeaders(extensions: readonly ExtensionRules[]): boolean {
  return extensions.some((extension) => extension.indexes.some((index) => index.hasModifyHeaders || index.headerConditioned.length > 0));
}
