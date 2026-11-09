import type { Session } from 'electron';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { addWebRequestStage, removeWebRequestStage, STAGE_ORDER } from '../../net/dispatcher';
import { tabIdForWebContents } from '../../tabs';
import type { JsonStore } from '../../store';
import { HostAccess } from './host-access';
import { anyModifyHeaders, evaluateBeforeRequest, evaluateHeaders, type ExtensionRules, type FrameAllowance, type HeaderPlan } from './matcher';
import { dnrStore, type DnrPersisted } from './persist';
import { createRequestInfo, dnrResourceType } from './request';
import { RedirectResources } from './resources';
import { compileRule, isSafeRule, type CompiledRule } from './rule';
import { buildRuleset, mergeRulesets, Ruleset, type RuleIndex } from './ruleset';
import { DYNAMIC_RULESET_ID, LIMITS, SESSION_RULESET_ID, type RequestInfo, type Rule, type RulesetResource } from './types';

/**
 * declarativeNetRequest for extensions, per Space session. Electron implements no DNR, so the
 * rules are evaluated here, inside the session's webRequest pipeline (net/dispatcher.ts), after
 * Vela's own blocker. Nothing is registered for a session until an extension with a DNR
 * permission is loaded into it.
 */

/** What the extension runtime (electron-chrome-extensions host) provides to the engine. */
export interface DnrHost {
  setBadgeText(extensionId: string, tabId: number, text: string): void;
  /** Origins granted at runtime through chrome.permissions.request. */
  grantedOrigins(extensionId: string): readonly string[];
  sendEvent(extensionId: string, eventName: string, ...args: unknown[]): void;
}

export interface MatchedRuleInfo {
  rule: { ruleId: number; rulesetId: string };
  tabId: number;
  timeStamp: number;
}

export interface LoadStats {
  rulesets: number;
  rules: number;
  ms: number;
}

const STAGE = 'dnr';
const MATCHED_KEEP_MS = 5 * 60_000;
const MATCHED_MAX = 5000;
const BADGE_DELAY_MS = 250;
const FRAME_RECORDS_MAX = 4000;
const PLANS_MAX = 2048;
const STATIC_RULE_LIMIT = LIMITS.GUARANTEED_MINIMUM_STATIC_RULES + LIMITS.GLOBAL_STATIC_RULE_POOL;

interface Manifest {
  version?: string;
  permissions?: unknown[];
  host_permissions?: unknown[];
  optional_host_permissions?: unknown[];
  declarative_net_request?: { rule_resources?: unknown[] };
  web_accessible_resources?: unknown;
}

export class DnrError extends Error {}

function parseJson(text: string): unknown {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

function yieldToLoop(): Promise<void> {
  return new Promise((done) => setImmediate(done));
}

function rulesetResources(manifest: Manifest): RulesetResource[] {
  const raw = manifest.declarative_net_request?.rule_resources;
  if (!Array.isArray(raw)) return [];
  const out: RulesetResource[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, LIMITS.MAX_NUMBER_OF_STATIC_RULESETS)) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, enabled, path } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.startsWith('_') || seen.has(id) || typeof path !== 'string') continue;
    seen.add(id);
    out.push({ id, enabled: enabled === true, path });
  }
  return out;
}

export class ExtensionDnr {
  readonly resources: RulesetResource[];
  readonly permission: 'all' | 'host';
  readonly feedback: boolean;
  readonly activeTab: boolean;
  private readonly manifestAccess: HostAccess;
  private grantedKey = '';
  private grantedAccess = new HostAccess();
  private readonly loaded = new Map<string, Ruleset>();
  private enabled: string[] = [];
  private disabledStatic = new Map<string, Set<number>>();
  private dynamic: Ruleset;
  private dynamicIndex: RuleIndex;
  private sessionRules: Ruleset;
  private sessionIndex: RuleIndex;
  private staticIndex: RuleIndex = mergeRulesets([]);
  readonly redirects: RedirectResources;
  rules: ExtensionRules;
  badge = false;
  readonly badgeCounts = new Map<number, number>();
  readonly matched: MatchedRuleInfo[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly store: JsonStore<DnrPersisted>;
  loadStats: LoadStats = { rulesets: 0, rules: 0, ms: 0 };

  constructor(
    readonly id: string,
    readonly root: string,
    private readonly manifest: Manifest,
    readonly installRank: number,
    readonly unpacked: boolean,
    spaceId: string,
    private readonly owner: SessionDnr,
  ) {
    const permissions = (manifest.permissions ?? []).filter((entry): entry is string => typeof entry === 'string');
    this.permission = permissions.includes('declarativeNetRequest') ? 'all' : 'host';
    this.feedback = permissions.includes('declarativeNetRequestFeedback');
    this.activeTab = permissions.includes('activeTab');
    const hosts = [...(manifest.host_permissions ?? []), ...permissions.filter((entry) => entry.includes('://') || entry === '<all_urls>')];
    this.manifestAccess = new HostAccess(hosts.filter((entry): entry is string => typeof entry === 'string'));
    this.resources = rulesetResources(manifest);
    this.store = dnrStore(spaceId, id);
    this.dynamic = new Ruleset(DYNAMIC_RULESET_ID, 'dynamic', []);
    this.dynamicIndex = this.dynamic.index;
    this.sessionRules = new Ruleset(SESSION_RULESET_ID, 'session', []);
    this.sessionIndex = this.sessionRules.index;
    this.redirects = new RedirectResources(id, root, manifest);
    this.rules = this.makeRules();
  }

  private makeRules(): ExtensionRules {
    const indexes = [this.sessionIndex, this.dynamicIndex, this.staticIndex].filter((index) => index.size > 0);
    return {
      extensionId: this.id,
      installRank: this.installRank,
      indexes,
      permission: this.permission,
      hasHostAccess: (url) => this.hasHostAccess(url),
    };
  }

  hasHostAccess(url: string): boolean {
    if (this.manifestAccess.allows(url)) return true;
    const granted = this.owner.host?.grantedOrigins(this.id) ?? [];
    const key = granted.join('\n');
    if (key !== this.grantedKey) {
      this.grantedKey = key;
      this.grantedAccess = new HostAccess(granted);
    }
    return this.grantedAccess.allows(url);
  }

  /** Serialize API operations (Chrome applies them in call order). */
  run<T>(op: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private publish(): void {
    this.rules = this.makeRules();
    this.owner.refresh();
  }

  private persist(patch: Partial<DnrPersisted>): void {
    this.store.update((current) => ({ ...current, ...patch }));
  }

  // -------------------------------------------------------------------------
  // loading

  async load(): Promise<void> {
    const started = performance.now();
    const saved = this.store.get();
    const version = this.manifest.version ?? null;
    const known = new Set(this.resources.map((resource) => resource.id));
    const fresh = saved.version !== version || !Array.isArray(saved.enabledRulesets);
    this.enabled = fresh ? this.resources.filter((resource) => resource.enabled).map((resource) => resource.id) : saved.enabledRulesets!.filter((id) => known.has(id));
    for (const [rulesetId, ids] of Object.entries(saved.disabledStaticRules ?? {})) {
      if (known.has(rulesetId) && Array.isArray(ids)) this.disabledStatic.set(rulesetId, new Set(ids.filter(Number.isInteger)));
    }
    this.badge = saved.displayActionCountAsBadgeText === true;
    if (fresh) this.persist({ version, enabledRulesets: null });
    this.dynamic = buildRuleset(DYNAMIC_RULESET_ID, 'dynamic', Array.isArray(saved.dynamicRules) ? saved.dynamicRules : [], true);
    this.dynamicIndex = this.dynamic.index;
    await this.ensureLoaded(this.enabled);
    this.rebuildStatic();
    this.loadStats = { rulesets: this.enabled.length, rules: this.enabledStaticCount(), ms: Math.round(performance.now() - started) };
    this.publish();
  }

  private resourceFile(resource: RulesetResource): string {
    const file = resolve(this.root, resource.path.replace(/^\/+/, ''));
    const inside = relative(this.root, file);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new DnrError(`Invalid ruleset path for "${resource.id}"`);
    return file;
  }

  private async loadRuleset(resource: RulesetResource): Promise<Ruleset> {
    let raw: unknown;
    try {
      raw = parseJson(await readFile(this.resourceFile(resource), 'utf8'));
    } catch {
      raw = [];
    }
    await yieldToLoop();
    const ruleset = buildRuleset(resource.id, 'static', Array.isArray(raw) ? raw : [], false);
    ruleset.disabled = this.disabledStatic.get(resource.id) ?? new Set();
    return ruleset;
  }

  private async ensureLoaded(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      if (this.loaded.has(id)) continue;
      const resource = this.resources.find((entry) => entry.id === id);
      if (!resource) continue;
      this.loaded.set(id, await this.loadRuleset(resource));
      await yieldToLoop();
    }
  }

  private rebuildStatic(): void {
    for (const id of [...this.loaded.keys()]) if (!this.enabled.includes(id)) this.loaded.delete(id);
    const rulesets = this.enabled.map((id) => this.loaded.get(id)).filter((ruleset): ruleset is Ruleset => !!ruleset);
    for (const ruleset of rulesets) ruleset.disabled = this.disabledStatic.get(ruleset.id) ?? new Set();
    this.staticIndex = mergeRulesets(rulesets);
  }

  private enabledStaticCount(): number {
    let count = 0;
    for (const id of this.enabled) count += this.loaded.get(id)?.size ?? 0;
    return count;
  }

  hasModifyHeaders(): boolean {
    return anyModifyHeaders([this.rules]);
  }

  hasAllowAllRequests(): boolean {
    return this.rules.indexes.some((index) => index.hasAllowAllRequests);
  }

  // -------------------------------------------------------------------------
  // chrome.declarativeNetRequest

  getEnabledRulesets(): string[] {
    return [...this.enabled];
  }

  async updateEnabledRulesets(enable: readonly string[], disable: readonly string[]): Promise<void> {
    const known = new Set(this.resources.map((resource) => resource.id));
    for (const id of [...enable, ...disable]) if (!known.has(id)) throw new DnrError(`Invalid ruleset id: ${id}.`);
    const next = this.resources
      .map((resource) => resource.id)
      .filter((id) => (this.enabled.includes(id) && !disable.includes(id)) || enable.includes(id));
    if (next.length > LIMITS.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS) {
      throw new DnrError(`The number of enabled static rulesets exceeds the limit (${LIMITS.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS}).`);
    }
    await this.ensureLoaded(next);
    let total = 0;
    for (const id of next) total += this.loaded.get(id)?.size ?? 0;
    if (total > STATIC_RULE_LIMIT) {
      for (const id of next) if (!this.enabled.includes(id)) this.loaded.delete(id);
      throw new DnrError('The number of enabled static rules exceeds the rule count limit.');
    }
    this.enabled = next;
    this.rebuildStatic();
    this.persist({ enabledRulesets: next, version: this.manifest.version ?? null });
    this.publish();
  }

  getAvailableStaticRuleCount(): number {
    return Math.max(0, STATIC_RULE_LIMIT - this.enabledStaticCount());
  }

  async updateStaticRules(rulesetId: string, disableIds: readonly number[], enableIds: readonly number[]): Promise<void> {
    if (!this.resources.some((resource) => resource.id === rulesetId)) throw new DnrError(`Invalid ruleset id: ${rulesetId}.`);
    const current = new Set(this.disabledStatic.get(rulesetId) ?? []);
    for (const id of disableIds) current.add(id);
    for (const id of enableIds) current.delete(id);
    let total = 0;
    for (const set of this.disabledStatic.values()) total += set.size;
    total += current.size - (this.disabledStatic.get(rulesetId)?.size ?? 0);
    if (total > LIMITS.MAX_NUMBER_OF_DISABLED_STATIC_RULES) throw new DnrError('The number of disabled static rules exceeds the limit.');
    if (current.size > 0) this.disabledStatic.set(rulesetId, current);
    else this.disabledStatic.delete(rulesetId);
    const persisted: Record<string, number[]> = {};
    for (const [id, set] of this.disabledStatic) persisted[id] = [...set];
    this.persist({ disabledStaticRules: persisted });
    if (this.enabled.includes(rulesetId)) {
      this.rebuildStatic();
      this.publish();
    }
  }

  getDisabledRuleIds(rulesetId: string): number[] {
    if (!this.resources.some((resource) => resource.id === rulesetId)) throw new DnrError(`Invalid ruleset id: ${rulesetId}.`);
    return [...(this.disabledStatic.get(rulesetId) ?? [])];
  }

  private updateRules(kind: 'dynamic' | 'session', addRules: readonly unknown[], removeIds: readonly number[]): void {
    const current = kind === 'dynamic' ? this.dynamic : this.sessionRules;
    const remove = new Set(removeIds);
    const kept = current.rules.filter((rule) => !remove.has(rule.id));
    const ids = new Set(kept.map((rule) => rule.id));
    const added: CompiledRule[] = [];
    const rulesetId = kind === 'dynamic' ? DYNAMIC_RULESET_ID : SESSION_RULESET_ID;
    for (const raw of addRules) {
      const rule = compileRule(raw, { kind, rulesetId, keepSource: true });
      if (ids.has(rule.id)) throw new DnrError(`Rule with id ${rule.id} does not have a unique ID.`);
      ids.add(rule.id);
      added.push(rule);
    }
    const all = [...kept, ...added];
    const max = kind === 'dynamic' ? LIMITS.MAX_NUMBER_OF_DYNAMIC_RULES : LIMITS.MAX_NUMBER_OF_SESSION_RULES;
    if (all.length > max) throw new DnrError(`The number of ${kind} rules exceeds the rule count limit.`);
    const unsafeMax = kind === 'dynamic' ? LIMITS.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES : LIMITS.MAX_NUMBER_OF_UNSAFE_SESSION_RULES;
    if (all.filter((rule) => !isSafeRule(rule)).length > unsafeMax) throw new DnrError(`The number of unsafe ${kind} rules exceeds the rule count limit.`);
    if (all.filter((rule) => rule.isRegex).length > LIMITS.MAX_NUMBER_OF_REGEX_RULES) throw new DnrError(`The number of regex ${kind} rules exceeds the rule count limit.`);
    const next = new Ruleset(rulesetId, kind, all);
    if (kind === 'dynamic') {
      this.dynamic = next;
      this.dynamicIndex = next.index;
      this.persist({ dynamicRules: all.map((rule) => rule.source!) });
    } else {
      this.sessionRules = next;
      this.sessionIndex = next.index;
    }
    this.publish();
  }

  updateDynamicRules(addRules: readonly unknown[], removeIds: readonly number[]): void {
    this.updateRules('dynamic', addRules, removeIds);
  }

  updateSessionRules(addRules: readonly unknown[], removeIds: readonly number[]): void {
    this.updateRules('session', addRules, removeIds);
  }

  getRules(kind: 'dynamic' | 'session', ruleIds: readonly number[] | null): Rule[] {
    const source = kind === 'dynamic' ? this.dynamic : this.sessionRules;
    const wanted = ruleIds ? new Set(ruleIds) : null;
    return source.rules.filter((rule) => !wanted || wanted.has(rule.id)).map((rule) => structuredClone(rule.source!));
  }

  setBadge(enabled: boolean): void {
    if (this.badge === enabled) return;
    this.badge = enabled;
    this.persist({ displayActionCountAsBadgeText: enabled });
    if (enabled) for (const tabId of this.badgeCounts.keys()) this.owner.queueBadge(this, tabId);
    else for (const tabId of this.badgeCounts.keys()) this.owner.host?.setBadgeText(this.id, tabId, '');
  }

  incrementBadge(tabId: number, increment: number): void {
    const next = Math.max(0, (this.badgeCounts.get(tabId) ?? 0) + increment);
    this.badgeCounts.set(tabId, next);
    if (this.badge) this.owner.queueBadge(this, tabId);
  }

  recordMatch(rule: CompiledRule, tabId: number): void {
    if (!this.feedback && !this.activeTab) return;
    const now = Date.now();
    if (this.matched.length >= MATCHED_MAX) {
      const cutoff = now - MATCHED_KEEP_MS;
      const firstFresh = this.matched.findIndex((entry) => entry.timeStamp >= cutoff);
      this.matched.splice(0, firstFresh < 0 ? this.matched.length : Math.max(firstFresh, this.matched.length - MATCHED_MAX + 1));
    }
    this.matched.push({ rule: { ruleId: rule.id, rulesetId: rule.rulesetId }, tabId, timeStamp: now });
  }

  getMatchedRules(tabId: number | null, minTimeStamp: number | null): MatchedRuleInfo[] {
    const cutoff = Math.max(minTimeStamp ?? 0, Date.now() - MATCHED_KEEP_MS);
    return this.matched.filter((entry) => entry.timeStamp >= cutoff && (tabId === null || entry.tabId === tabId)).map((entry) => structuredClone(entry));
  }
}

function frameOf(details: { frame?: Electron.WebFrameMain | null }): Electron.WebFrameMain | null {
  try {
    return details.frame ?? null;
  } catch {
    return null;
  }
}

function frameNodeId(frame: Electron.WebFrameMain | null | undefined): number | null {
  try {
    return frame && !frame.detached ? frame.frameTreeNodeId : null;
  } catch {
    return null;
  }
}

type RequestDetails = Electron.OnBeforeRequestListenerDetails | Electron.OnBeforeSendHeadersListenerDetails | Electron.OnHeadersReceivedListenerDetails;

/** The initiator for host-permission checks; opaque (`null`) initiators count as none. */
function initiatorOf(details: RequestDetails): string | null {
  const origin = details.initiatorOrigin;
  return origin && origin !== 'null' ? origin : null;
}

export class SessionDnr {
  readonly extensions = new Map<string, ExtensionDnr>();
  host: DnrHost | null = null;
  private list: ExtensionRules[] = [];
  private anyModify = false;
  private anyAllowAll = false;
  private attached = false;
  /** frameTreeNodeId → extensionId → allowAllRequests priority in effect for that frame. */
  private readonly frames = new Map<number, Map<string, number>>();
  private readonly badgeQueue = new Map<ExtensionDnr, Set<number>>();
  private badgeTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly session: Session,
    readonly spaceId: string,
  ) {}

  refresh(): void {
    const all = [...this.extensions.values()];
    this.list = all.map((extension) => extension.rules).filter((rules) => rules.indexes.length > 0);
    this.anyModify = anyModifyHeaders(this.list);
    this.anyAllowAll = all.some((extension) => extension.hasAllowAllRequests());
    if (!this.anyAllowAll) this.frames.clear();
    this.attach(this.extensions.size > 0);
  }

  private attach(wanted: boolean): void {
    if (wanted === this.attached) return;
    this.attached = wanted;
    const session = this.session;
    if (!wanted) {
      removeWebRequestStage(session, 'beforeRequest', STAGE);
      removeWebRequestStage(session, 'beforeSendHeaders', STAGE);
      removeWebRequestStage(session, 'headersReceived', STAGE);
      return;
    }
    addWebRequestStage(session, 'beforeRequest', STAGE, STAGE_ORDER.dnr, (details) => this.onBeforeRequest(details));
    addWebRequestStage(session, 'beforeSendHeaders', STAGE, STAGE_ORDER.dnr, (details, headers) => this.onBeforeSendHeaders(details, headers));
    addWebRequestStage(session, 'headersReceived', STAGE, STAGE_ORDER.dnr, (details) => this.onHeadersReceived(details));
  }

  dispose(): void {
    if (this.badgeTimer) clearTimeout(this.badgeTimer);
    this.extensions.clear();
    this.refresh();
  }

  private requestInfo(details: RequestDetails, responseHeaders?: Record<string, string[]>): RequestInfo | null {
    const initiator = details.initiatorOrigin;
    if (initiator?.startsWith('chrome-extension://')) return null;
    const wcId = details.webContentsId;
    if (wcId === undefined && !initiator) return null;
    const tabId = wcId !== undefined && tabIdForWebContents(wcId) !== null ? wcId : -1;
    return createRequestInfo({
      url: details.url,
      type: dnrResourceType(details.resourceType),
      method: details.method,
      initiator: initiator ?? null,
      tabId,
      responseHeaders,
    });
  }

  private allowanceFor(details: RequestDetails, type: string): FrameAllowance | undefined {
    if (!this.anyAllowAll || this.frames.size === 0) return undefined;
    const frame = frameOf(details);
    let node: number | null;
    if (type === 'main_frame') return undefined;
    if (type === 'sub_frame') node = frameNodeId(frame?.parent);
    else node = frameNodeId(frame);
    const record = node === null ? undefined : this.frames.get(node);
    if (!record) return undefined;
    return (extensionId) => record.get(extensionId) ?? 0;
  }

  private recordFrame(details: RequestDetails, matched: Map<string, number>, inherited: FrameAllowance | undefined): void {
    const node = frameNodeId(frameOf(details));
    if (node === null) return;
    const effective = new Map<string, number>();
    for (const extension of this.list) {
      const priority = Math.max(matched.get(extension.extensionId) ?? 0, inherited?.(extension.extensionId) ?? 0);
      if (priority > 0) effective.set(extension.extensionId, priority);
    }
    this.frames.delete(node);
    if (effective.size === 0) return;
    if (this.frames.size >= FRAME_RECORDS_MAX) {
      const oldest = this.frames.keys().next().value;
      if (oldest !== undefined) this.frames.delete(oldest);
    }
    this.frames.set(node, effective);
  }

  private onBeforeRequest(details: Electron.OnBeforeRequestListenerDetails): Electron.CallbackResponse | void {
    if (this.list.length === 0) return;
    const info = this.requestInfo(details);
    if (!info) return;
    const isFrame = info.type === 'main_frame' || info.type === 'sub_frame';
    if (info.type === 'main_frame' && info.tabId >= 0) this.resetBadges(info.tabId);
    const allowance = this.allowanceFor(details, info.type);
    const { outcome, allowAll, plan } = evaluateBeforeRequest(this.list, info, initiatorOf(details), allowance, this.anyModify);
    if (isFrame && this.anyAllowAll) this.recordFrame(details, allowAll, allowance);
    if (plan) this.rememberPlan(details.id, details.url, plan);
    if (!outcome) return;
    const extension = this.extensions.get(outcome.extension.extensionId);
    if (outcome.rule) {
      extension?.recordMatch(outcome.rule, info.tabId);
      if (extension?.unpacked && extension.feedback) this.debugEvent(extension, outcome.rule, details, info);
    }
    if (outcome.kind === 'allow') return;
    if (info.tabId >= 0) extension?.incrementBadge(info.tabId, 1);
    if (outcome.kind === 'block') return { cancel: true };
    return { redirectURL: extension ? extension.redirects.target(outcome.url, isFrame) : outcome.url };
  }

  /** Header plans of in-flight requests (bounded: requests that never reach the header phases age out). */
  private readonly plans = new Map<number, { url: string; plan: HeaderPlan }>();

  private rememberPlan(id: number, url: string, plan: HeaderPlan): void {
    this.plans.delete(id);
    if (this.plans.size >= PLANS_MAX) {
      const oldest = this.plans.keys().next().value;
      if (oldest !== undefined) this.plans.delete(oldest);
    }
    this.plans.set(id, { url, plan });
  }

  private planFor(details: RequestDetails, done: boolean): HeaderPlan | null {
    const entry = this.plans.get(details.id);
    if (!entry || entry.url !== details.url) return null;
    if (done) this.plans.delete(details.id);
    return entry.plan;
  }

  private onBeforeSendHeaders(details: Electron.OnBeforeSendHeadersListenerDetails, headers: Record<string, string>): void {
    if (!this.anyModify) return;
    const info = this.requestInfo(details);
    if (!info) return;
    const result = evaluateHeaders(this.list, info, initiatorOf(details), { kind: 'request', headers }, this.allowanceFor(details, info.type), this.planFor(details, false));
    for (const { rule, extension } of result.applied) this.extensions.get(extension.extensionId)?.recordMatch(rule, info.tabId);
  }

  private onHeadersReceived(details: Electron.OnHeadersReceivedListenerDetails): Electron.HeadersReceivedResponse | void {
    if (!this.anyModify) return;
    const headers = details.responseHeaders ?? {};
    const info = this.requestInfo(details, headers);
    if (!info) return;
    const result = evaluateHeaders(this.list, info, initiatorOf(details), { kind: 'response', headers }, this.allowanceFor(details, info.type), this.planFor(details, true));
    if (result.block) {
      const extension = this.extensions.get(result.block.extension.extensionId);
      extension?.recordMatch(result.block.rule, info.tabId);
      if (info.tabId >= 0) extension?.incrementBadge(info.tabId, 1);
      return { cancel: true };
    }
    if (result.applied.length === 0) return;
    for (const { rule, extension } of result.applied) this.extensions.get(extension.extensionId)?.recordMatch(rule, info.tabId);
    return { responseHeaders: headers };
  }

  private debugEvent(extension: ExtensionDnr, rule: CompiledRule, details: Electron.OnBeforeRequestListenerDetails, info: RequestInfo): void {
    this.host?.sendEvent(extension.id, 'declarativeNetRequest.onRuleMatchedDebug', {
      request: {
        requestId: String(details.id),
        url: details.url,
        method: details.method,
        type: info.type,
        tabId: info.tabId,
        initiator: details.initiatorOrigin,
        frameId: -1,
        parentFrameId: -1,
      },
      rule: { ruleId: rule.id, rulesetId: rule.rulesetId },
    });
  }

  private resetBadges(tabId: number): void {
    for (const extension of this.extensions.values()) {
      if (!extension.badgeCounts.has(tabId)) continue;
      extension.badgeCounts.delete(tabId);
      if (extension.badge) this.host?.setBadgeText(extension.id, tabId, '');
    }
  }

  queueBadge(extension: ExtensionDnr, tabId: number): void {
    let tabs = this.badgeQueue.get(extension);
    if (!tabs) {
      tabs = new Set();
      this.badgeQueue.set(extension, tabs);
    }
    tabs.add(tabId);
    if (this.badgeTimer) return;
    this.badgeTimer = setTimeout(() => {
      this.badgeTimer = null;
      const queued = [...this.badgeQueue];
      this.badgeQueue.clear();
      for (const [owner, ids] of queued) {
        if (!owner.badge || this.extensions.get(owner.id) !== owner) continue;
        for (const id of ids) {
          const count = owner.badgeCounts.get(id) ?? 0;
          this.host?.setBadgeText(owner.id, id, count > 0 ? String(count) : '');
        }
      }
    }, BADGE_DELAY_MS);
    this.badgeTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// registry of sessions

const sessions = new Map<Session, SessionDnr>();

export function dnrFor(session: Session): SessionDnr | undefined {
  return sessions.get(session);
}

function sessionDnr(session: Session, spaceId: string): SessionDnr {
  let state = sessions.get(session);
  if (!state) {
    state = new SessionDnr(session, spaceId);
    sessions.set(session, state);
  }
  return state;
}

export function setDnrHost(session: Session, spaceId: string, host: DnrHost): void {
  sessionDnr(session, spaceId).host = host;
}

/** Whether an extension asks for any declarativeNetRequest permission. */
export function usesDnr(manifest: unknown): boolean {
  const permissions = (manifest as Manifest | null)?.permissions;
  return Array.isArray(permissions) && (permissions.includes('declarativeNetRequest') || permissions.includes('declarativeNetRequestWithHostAccess'));
}

/**
 * Start evaluating an extension's rules in a session (after Chromium loaded it). Resolves once its
 * enabled static rulesets are compiled, so the Space's first page load can wait for blocking.
 */
export async function loadDnr(
  session: Session,
  spaceId: string,
  extension: Electron.Extension,
  options: { installRank: number; unpacked: boolean },
): Promise<LoadStats | null> {
  if (!usesDnr(extension.manifest)) return null;
  const state = sessionDnr(session, spaceId);
  const dnr = new ExtensionDnr(extension.id, extension.path, extension.manifest as Manifest, options.installRank, options.unpacked, spaceId, state);
  state.extensions.set(extension.id, dnr);
  await dnr.run(() => dnr.load());
  if (state.extensions.get(extension.id) !== dnr) return null;
  state.refresh();
  if (process.env.VELA_DNR_DEBUG) console.info(`[dnr] ${extension.id} in space ${spaceId}: ${dnr.loadStats.rulesets} rulesets, ${dnr.loadStats.rules} static rules, ${dnr.loadStats.ms} ms`);
  return dnr.loadStats;
}

export function unloadDnr(session: Session, extensionId: string): void {
  const state = sessions.get(session);
  if (!state?.extensions.delete(extensionId)) return;
  state.refresh();
}

export function forgetDnrSession(session: Session): void {
  sessions.get(session)?.dispose();
  sessions.delete(session);
}
