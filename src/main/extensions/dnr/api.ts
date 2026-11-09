import type { Session } from 'electron';
import { dnrFor, DnrError, type ExtensionDnr } from './engine';
import { compileRegexFilter, translateRegex } from './pattern';
import { createRequestInfo } from './request';
import { RuleError } from './rule';
import { evaluateBeforeRequest, evaluateHeaders } from './matcher';
import { RESOURCE_TYPES, type ResourceType } from './types';

/**
 * chrome.declarativeNetRequest handlers, registered on the electron-chrome-extensions router of a
 * Space session (the extension pages / service worker reach them through `crx-msg`, see
 * src/preload/dnr.ts). Every argument is untrusted.
 */

interface RouterEvent {
  extension?: Electron.Extension;
}

type Handler = (event: RouterEvent, ...args: unknown[]) => unknown;

export interface Router {
  handle(name: string, callback: Handler, options?: { extensionContext?: boolean; permission?: string }): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionsOf(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new DnrError('Invalid argument.');
  return value;
}

function idList(value: unknown, name: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => Number.isInteger(entry))) throw new DnrError(`Invalid "${name}".`);
  return value as number[];
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) throw new DnrError(`Invalid "${name}".`);
  return value as string[];
}

function ruleList(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new DnrError('Invalid "addRules".');
  return value;
}

function withExtension(session: Session, fn: (extension: ExtensionDnr, ...args: unknown[]) => unknown): Handler {
  return async (event, ...args) => {
    const id = event.extension?.id;
    const extension = id ? dnrFor(session)?.extensions.get(id) : undefined;
    if (!extension) throw new Error('declarativeNetRequest requires the "declarativeNetRequest" permission.');
    try {
      return await extension.run(() => fn(extension, ...args));
    } catch (error) {
      if (error instanceof DnrError || error instanceof RuleError) throw new Error(error.message);
      throw error;
    }
  };
}

function requireFeedback(extension: ExtensionDnr, tabId: number | null): void {
  if (extension.feedback) return;
  if (extension.activeTab && tabId !== null) return;
  throw new DnrError('The extension must have the declarativeNetRequestFeedback permission or have activeTab granted for the specified tab ID.');
}

export function registerDnrApi(router: Router, session: Session): void {
  const handle = (name: string, fn: (extension: ExtensionDnr, ...args: unknown[]) => unknown): void => {
    router.handle(`declarativeNetRequest.${name}`, withExtension(session, fn));
  };

  handle('updateDynamicRules', (extension, options) => {
    const { addRules, removeRuleIds } = optionsOf(options);
    extension.updateDynamicRules(ruleList(addRules), idList(removeRuleIds, 'removeRuleIds'));
  });
  handle('getDynamicRules', (extension, filter) => {
    const { ruleIds } = optionsOf(filter);
    return extension.getRules('dynamic', ruleIds === undefined ? null : idList(ruleIds, 'ruleIds'));
  });
  handle('updateSessionRules', (extension, options) => {
    const { addRules, removeRuleIds } = optionsOf(options);
    extension.updateSessionRules(ruleList(addRules), idList(removeRuleIds, 'removeRuleIds'));
  });
  handle('getSessionRules', (extension, filter) => {
    const { ruleIds } = optionsOf(filter);
    return extension.getRules('session', ruleIds === undefined ? null : idList(ruleIds, 'ruleIds'));
  });
  handle('updateEnabledRulesets', (extension, options) => {
    const { enableRulesetIds, disableRulesetIds } = optionsOf(options);
    return extension.updateEnabledRulesets(stringList(enableRulesetIds, 'enableRulesetIds'), stringList(disableRulesetIds, 'disableRulesetIds'));
  });
  handle('getEnabledRulesets', (extension) => extension.getEnabledRulesets());
  handle('getAvailableStaticRuleCount', (extension) => extension.getAvailableStaticRuleCount());
  handle('updateStaticRules', (extension, options) => {
    const { rulesetId, disableRuleIds, enableRuleIds } = optionsOf(options);
    if (typeof rulesetId !== 'string') throw new DnrError('Invalid "rulesetId".');
    return extension.updateStaticRules(rulesetId, idList(disableRuleIds, 'disableRuleIds'), idList(enableRuleIds, 'enableRuleIds'));
  });
  handle('getDisabledRuleIds', (extension, options) => {
    const { rulesetId } = optionsOf(options);
    if (typeof rulesetId !== 'string') throw new DnrError('Invalid "rulesetId".');
    return extension.getDisabledRuleIds(rulesetId);
  });
  handle('isRegexSupported', (_extension, options) => {
    const { regex, isCaseSensitive } = optionsOf(options);
    if (typeof regex !== 'string') throw new DnrError('Invalid "regex".');
    const translated = translateRegex(regex);
    if ('problem' in translated) return { isSupported: false, reason: translated.problem };
    compileRegexFilter(translated, isCaseSensitive === true);
    return { isSupported: true };
  });
  handle('setExtensionActionOptions', (extension, options) => {
    const { displayActionCountAsBadgeText, tabUpdate } = optionsOf(options);
    if (displayActionCountAsBadgeText !== undefined) extension.setBadge(displayActionCountAsBadgeText === true);
    if (tabUpdate !== undefined) {
      if (!isObject(tabUpdate) || !Number.isInteger(tabUpdate.tabId) || !Number.isInteger(tabUpdate.increment)) throw new DnrError('Invalid "tabUpdate".');
      extension.incrementBadge(tabUpdate.tabId as number, tabUpdate.increment as number);
    }
  });
  handle('getMatchedRules', (extension, filter) => {
    const { tabId, minTimeStamp } = optionsOf(filter);
    const tab = Number.isInteger(tabId) ? (tabId as number) : null;
    requireFeedback(extension, tab);
    const since = typeof minTimeStamp === 'number' ? minTimeStamp : null;
    return { rulesMatchedInfo: extension.getMatchedRules(tab, since) };
  });
  handle('testMatchOutcome', (extension, details) => {
    if (!extension.unpacked) throw new DnrError('testMatchOutcome is only available to unpacked extensions.');
    const request = optionsOf(details);
    if (typeof request.url !== 'string' || !RESOURCE_TYPES.includes(request.type as ResourceType)) throw new DnrError('Invalid request details.');
    const info = createRequestInfo({
      url: request.url,
      type: request.type as ResourceType,
      method: typeof request.method === 'string' ? request.method : 'get',
      initiator: typeof request.initiator === 'string' ? request.initiator : null,
      tabId: Number.isInteger(request.tabId) ? (request.tabId as number) : -1,
      responseHeaders: isObject(request.responseHeaders) ? (request.responseHeaders as Record<string, string[]>) : undefined,
    });
    if (!info) return { matchedRules: [] };
    const initiator = typeof request.initiator === 'string' ? request.initiator : null;
    const matchedRules: { ruleId: number; rulesetId: string }[] = [];
    const { outcome } = evaluateBeforeRequest([extension.rules], info, initiator);
    if (outcome?.rule) matchedRules.push({ ruleId: outcome.rule.id, rulesetId: outcome.rule.rulesetId });
    if (outcome?.kind !== 'block' && outcome?.kind !== 'redirect') {
      for (const kind of ['request', 'response'] as const) {
        const target = kind === 'request' ? { kind, headers: {} as Record<string, string> } : { kind, headers: {} as Record<string, string[]> };
        for (const { rule } of evaluateHeaders([extension.rules], info, initiator, target).applied) {
          if (!matchedRules.some((entry) => entry.ruleId === rule.id && entry.rulesetId === rule.rulesetId)) matchedRules.push({ ruleId: rule.id, rulesetId: rule.rulesetId });
        }
      }
    }
    return { matchedRules };
  });
}
