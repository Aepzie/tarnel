import { contextBridge, ipcRenderer } from 'electron';

/**
 * chrome.declarativeNetRequest for extension service workers and pages (registered as a session
 * preload by src/main/extensions/dnr/index.ts, before electron-chrome-extensions' own preload, which
 * freezes `chrome`). Calls travel over the library's `crx-msg` channel to the handlers in
 * src/main/extensions/dnr/api.ts; events use its `crx-add-listener` protocol.
 */

type Invoke = (extensionId: string, name: string, args: unknown[]) => Promise<unknown>;
type Listen = (extensionId: string, name: string, callback: (...args: unknown[]) => void) => void;

const invoke: Invoke = (extensionId, name, args) => ipcRenderer.invoke('crx-msg', extensionId, `declarativeNetRequest.${name}`, ...args);

const listeners = new Map<(...args: unknown[]) => void, (event: unknown, ...args: unknown[]) => void>();

const addListener: Listen = (extensionId, name, callback) => {
  const channel = `crx-declarativeNetRequest.${name}`;
  if (listeners.size === 0) ipcRenderer.send('crx-add-listener', extensionId, `declarativeNetRequest.${name}`);
  const wrapped = (_event: unknown, ...args: unknown[]): void => callback(...args);
  listeners.set(callback, wrapped);
  ipcRenderer.on(channel, wrapped);
};

const removeListener: Listen = (extensionId, name, callback) => {
  const wrapped = listeners.get(callback);
  if (!wrapped) return;
  listeners.delete(callback);
  ipcRenderer.removeListener(`crx-declarativeNetRequest.${name}`, wrapped);
  if (listeners.size === 0) ipcRenderer.send('crx-remove-listener', extensionId, `declarativeNetRequest.${name}`);
};

/** Runs in the extension's main world. Must be self-contained (it is serialized). */
function installDeclarativeNetRequest(call: Invoke, on: Listen, off: Listen): void {
  const chromeApi = (globalThis as { chrome?: Record<string, unknown> & { runtime?: { id?: string; getManifest?: () => { permissions?: unknown[] }; lastError?: unknown } } }).chrome;
  const runtime = chromeApi?.runtime;
  const extensionId = runtime?.id;
  if (!chromeApi || !runtime || !extensionId || chromeApi.declarativeNetRequest) return;
  const permissions = runtime.getManifest?.().permissions ?? [];
  if (!permissions.includes('declarativeNetRequest') && !permissions.includes('declarativeNetRequestWithHostAccess')) return;

  const PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;
  const withLastError = (error: unknown, callback: (...args: unknown[]) => void): void => {
    const message = error instanceof Error ? error.message.replace(PREFIX, '') : String(error);
    let set = false;
    try {
      Object.defineProperty(runtime, 'lastError', { value: { message }, configurable: true });
      set = true;
    } catch {
      set = false;
    }
    try {
      callback();
    } finally {
      if (set) {
        try {
          delete (runtime as { lastError?: unknown }).lastError;
        } catch {
          /* leave it */
        }
      }
    }
  };

  /** A promise / callback API method (the callback, when given, is the last argument). */
  const method =
    (name: string, arity: number) =>
    (...args: unknown[]): Promise<unknown> | undefined => {
      const callback = typeof args[args.length - 1] === 'function' ? (args.pop() as (...values: unknown[]) => void) : undefined;
      const sent = args.slice(0, arity);
      const pending = call(extensionId, name, sent).catch((error: unknown) => {
        throw new Error(error instanceof Error ? error.message.replace(PREFIX, '') : String(error));
      });
      if (!callback) return pending;
      pending.then(
        (value) => callback(value),
        (error: unknown) => withLastError(error, callback),
      );
      return undefined;
    };

  const event = (name: string) => {
    const callbacks = new Set<(...args: unknown[]) => void>();
    return {
      addListener(callback: (...args: unknown[]) => void) {
        if (typeof callback !== 'function' || callbacks.has(callback)) return;
        callbacks.add(callback);
        on(extensionId, name, callback);
      },
      removeListener(callback: (...args: unknown[]) => void) {
        if (!callbacks.delete(callback)) return;
        off(extensionId, name, callback);
      },
      hasListener(callback: (...args: unknown[]) => void) {
        return callbacks.has(callback);
      },
      hasListeners() {
        return callbacks.size > 0;
      },
    };
  };

  const resourceTypes = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];
  const enumOf = (values: string[]) => Object.freeze(Object.fromEntries(values.map((value) => [value.toUpperCase(), value])));

  const api = {
    GUARANTEED_MINIMUM_STATIC_RULES: 30000,
    MAX_NUMBER_OF_STATIC_RULESETS: 100,
    MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50,
    MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
    MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5000,
    MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 30000,
    MAX_NUMBER_OF_SESSION_RULES: 5000,
    MAX_NUMBER_OF_UNSAFE_SESSION_RULES: 5000,
    MAX_NUMBER_OF_REGEX_RULES: 1000,
    MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL: 20,
    GETMATCHEDRULES_QUOTA_INTERVAL: 10,
    DYNAMIC_RULESET_ID: '_dynamic',
    SESSION_RULESET_ID: '_session',
    ResourceType: enumOf(resourceTypes),
    RequestMethod: enumOf(['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'other']),
    DomainType: Object.freeze({ FIRST_PARTY: 'firstParty', THIRD_PARTY: 'thirdParty' }),
    RuleActionType: Object.freeze({
      BLOCK: 'block',
      REDIRECT: 'redirect',
      ALLOW: 'allow',
      UPGRADE_SCHEME: 'upgradeScheme',
      MODIFY_HEADERS: 'modifyHeaders',
      ALLOW_ALL_REQUESTS: 'allowAllRequests',
    }),
    HeaderOperation: Object.freeze({ APPEND: 'append', SET: 'set', REMOVE: 'remove' }),
    UnsupportedRegexReason: Object.freeze({ SYNTAX_ERROR: 'syntaxError', MEMORY_LIMIT_EXCEEDED: 'memoryLimitExceeded' }),
    updateDynamicRules: method('updateDynamicRules', 1),
    getDynamicRules: method('getDynamicRules', 1),
    updateSessionRules: method('updateSessionRules', 1),
    getSessionRules: method('getSessionRules', 1),
    updateEnabledRulesets: method('updateEnabledRulesets', 1),
    getEnabledRulesets: method('getEnabledRulesets', 0),
    getAvailableStaticRuleCount: method('getAvailableStaticRuleCount', 0),
    updateStaticRules: method('updateStaticRules', 1),
    getDisabledRuleIds: method('getDisabledRuleIds', 1),
    isRegexSupported: method('isRegexSupported', 1),
    setExtensionActionOptions: method('setExtensionActionOptions', 1),
    getMatchedRules: method('getMatchedRules', 1),
    testMatchOutcome: method('testMatchOutcome', 1),
    onRuleMatchedDebug: event('onRuleMatchedDebug'),
  };

  // Writable and extensible on purpose: extensions (uBlock Origin Lite) attach helpers to it.
  Object.defineProperty(chromeApi, 'declarativeNetRequest', { value: api, enumerable: true, configurable: true, writable: true });
}

const isExtensionContext = process.type === 'service-worker' || (typeof location !== 'undefined' && location.href.startsWith('chrome-extension://'));

if (isExtensionContext) {
  try {
    contextBridge.executeInMainWorld({ func: installDeclarativeNetRequest, args: [invoke, addListener, removeListener] });
  } catch {
    /* not an extension context the bridge can reach */
  }
}
