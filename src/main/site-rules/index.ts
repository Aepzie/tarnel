import { randomBytes } from 'node:crypto';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import {
  SITE_RULES_IPC,
  cleanSiteRules,
  resolveSiteRules,
  suggestPattern,
  type SiteRuleDraft,
  type SiteRuleNotice,
  type SiteRuleResolution,
} from '../../shared/site-rules';
import { registrableDomain } from '../privacy';
import { getSpace } from '../spaces';
import {
  createTab,
  getBrowserState,
  getTabSpaceId,
  getTabVpn,
  getTabWebContents,
  moveToSpace,
  navigateTab,
  onTabWebContents,
  setNavigationGate,
} from '../tabs';
import { canRouteTabs, routableCountries, routeTabByRule } from '../vpn';
import { sendToChrome } from '../window';
import { fingerprintOverrideOf, setFingerprintOverride, setUserAgentOverride, userAgentOverrideOf } from './overrides';
import { getSiteRules, setSiteRules } from './store';

/**
 * Applies site rules to top-level tab navigations, always before the request is made:
 *   - the tabs.ts navigation gate (typed URL, new tab from a link, restore, wake),
 *   - will-navigate (renderer-initiated: link clicks, location changes) → cancelled and re-run via the gate.
 * In order: Block → cancelled. Space → the tab moves to the target Space and loads the URL there.
 * VPN → the tab is routed like the tab VPN menu does (needs a live MantelVPN session; else a hint).
 * UA → per-tab webContents.setUserAgent before the load. Fingerprint → a per-tab level read by the
 * fingerprint config IPC ('random' = fresh seed per site visit).
 * Space and VPN stick after leaving the site (the tab now lives there); UA and fingerprint follow the site.
 * Server redirects and back/forward only refresh UA/fingerprint (did-start-navigation, never cancelled).
 * Precedence: rule > Space setting > global setting.
 */

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

const MAX_TEST_URL = 2048;
/** Hints already shown per tab (one per rule target, not one per page load). */
const shownNotices = new Map<number, string>();
/** VPN routes that failed per tab, so a failing route does not loop on every navigation. */
const failedRoutes = new Map<number, string>();
let pendingDraft: SiteRuleDraft | null = null;
let draftToken = 0;

function notify(tabId: number, key: string, message: string): void {
  if (shownNotices.get(tabId) === key) return;
  shownNotices.set(tabId, key);
  const notice: SiteRuleNotice = { tabId, message };
  sendToChrome(SITE_RULES_IPC.notice, notice);
}

function applyFingerprint(wc: WebContents, resolution: SiteRuleResolution): void {
  const level = resolution.fingerprint;
  const host = resolution.host;
  if (!level || !host) {
    setFingerprintOverride(wc, null);
    return;
  }
  const site = registrableDomain(host);
  const previous = fingerprintOverrideOf(wc);
  if (level !== 'random') {
    setFingerprintOverride(wc, { level, seed: null, host: site });
    return;
  }
  const keep = previous?.level === 'random' && previous.host === site && previous.seed;
  setFingerprintOverride(wc, { level, seed: keep ? previous.seed : randomBytes(32).toString('hex'), host: site });
}

/** Gives the tab the UA the rule wants (or back the session's); true when it changed. */
function applyUserAgent(wc: WebContents, wanted: string | null): boolean {
  if (wanted === userAgentOverrideOf(wc)) return false;
  setUserAgentOverride(wc, wanted);
  try {
    wc.setUserAgent(wanted ?? wc.session.getUserAgent());
  } catch {
    return false;
  }
  return true;
}

function rulesIdle(wc: WebContents): boolean {
  return getSiteRules().length === 0 && !fingerprintOverrideOf(wc) && !userAgentOverrideOf(wc);
}

function wantsRoute(tabId: number, resolution: SiteRuleResolution): boolean {
  return !!resolution.vpn && !!resolution.host && getTabVpn(tabId) !== resolution.vpn;
}

function wantsMove(tabId: number, resolution: SiteRuleResolution): boolean {
  const spaceId = getTabSpaceId(tabId);
  return !!resolution.space && !!spaceId && resolution.space !== spaceId && !!getSpace(resolution.space);
}

/**
 * Runs before tab `tabId` loads `url`. Returns true when a rule took the navigation over
 * (blocked, moving to a Space, being routed): the caller must not load it.
 */
function gate(wc: WebContents, tabId: number, url: string): boolean {
  if (rulesIdle(wc)) return false;
  const resolution = resolveSiteRules(getSiteRules(), url);
  const host = resolution.host;

  if (resolution.block && host) {
    notify(tabId, `block:${host}:${Date.now()}`, `${host} is blocked by a site rule.`);
    return true;
  }

  if (wantsMove(tabId, resolution)) {
    const target = resolution.space!;
    setImmediate(() => moveToSpace(tabId, target, url));
    return true;
  }

  if (wantsRoute(tabId, resolution)) {
    const country = resolution.vpn!;
    const routeKey = `${country}:${host}`;
    if (!canRouteTabs()) {
      notify(tabId, `vpn:${routeKey}`, `Sign in to MantelVPN to route ${host} through ${country.toUpperCase()} (site rule).`);
    } else if (failedRoutes.get(tabId) !== routeKey) {
      const fail = (message: string): void => {
        failedRoutes.set(tabId, routeKey);
        notify(tabId, `vpn-fail:${routeKey}`, message);
      };
      void routeTabByRule(tabId, country).then(
        (result) => {
          if (!result.ok) fail(result.error ?? 'The site rule could not route this tab through MantelVPN.');
          navigateTab(tabId, url);
        },
        () => {
          fail('The site rule could not route this tab through MantelVPN.');
          navigateTab(tabId, url);
        },
      );
      return true;
    }
  }

  applyFingerprint(wc, resolution);
  applyUserAgent(wc, resolution.userAgent);
  return false;
}

/** Must a renderer-initiated navigation go through the gate (anything beyond the fingerprint level)? */
function needsGate(wc: WebContents, tabId: number, url: string): boolean {
  if (rulesIdle(wc)) return false;
  const resolution = resolveSiteRules(getSiteRules(), url);
  if (resolution.block || wantsMove(tabId, resolution)) return true;
  if (wantsRoute(tabId, resolution) && canRouteTabs() && failedRoutes.get(tabId) !== `${resolution.vpn}:${resolution.host}`) return true;
  return resolution.userAgent !== userAgentOverrideOf(wc);
}

function watch(wc: WebContents, tabId: number): void {
  wc.on('will-navigate', (details) => {
    if (!details.isMainFrame || details.isSameDocument || !needsGate(wc, tabId, details.url)) return;
    details.preventDefault();
    const url = details.url;
    setImmediate(() => {
      if (!wc.isDestroyed() && !gate(wc, tabId, url)) navigateTab(tabId, url);
    });
  });
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument || rulesIdle(wc)) return;
    const resolution = resolveSiteRules(getSiteRules(), details.url);
    applyFingerprint(wc, resolution);
    applyUserAgent(wc, resolution.userAgent);
  });
  wc.once('destroyed', () => {
    if (getTabWebContents(tabId)) return;
    shownNotices.delete(tabId);
    failedRoutes.delete(tabId);
  });
}

function testUrl(raw: unknown): SiteRuleResolution {
  if (typeof raw !== 'string' || raw.length > MAX_TEST_URL) throw new TypeError('Invalid url');
  const input = raw.trim();
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  return resolveSiteRules(getSiteRules(), url);
}

/** "Create rule for this site…" in the tab menu: remember a draft and open the editor. */
function createFor(rawTabId: unknown): void {
  if (typeof rawTabId !== 'number' || !Number.isInteger(rawTabId)) throw new TypeError('Invalid tab');
  const url = getBrowserState().tabs.find((tab) => tab.id === rawTabId)?.url;
  const pattern = url ? suggestPattern(url) : null;
  draftToken += 1;
  pendingDraft = pattern ? { pattern, token: draftToken } : null;
  createTab({ url: 'tarnel://settings/#rules', active: true, afterId: rawTabId });
}

export function initSiteRules(): void {
  onTabWebContents(watch);
  setNavigationGate(gate);
}

export function registerSiteRulesIpc(handleChrome: ChromeHandler, handlePages: PagesHandler): void {
  handleChrome(SITE_RULES_IPC.chromeCreateFor, (tabId) => createFor(tabId));
  handlePages(SITE_RULES_IPC.list, () => getSiteRules());
  handlePages(SITE_RULES_IPC.save, (_event, rules) => {
    setSiteRules(cleanSiteRules(rules));
    return getSiteRules();
  });
  handlePages(SITE_RULES_IPC.test, (_event, url) => testUrl(url));
  handlePages(SITE_RULES_IPC.context, () => ({ vpnSignedIn: canRouteTabs(), countries: routableCountries() }));
  handlePages(SITE_RULES_IPC.draft, () => {
    const draft = pendingDraft;
    pendingDraft = null;
    return draft;
  });
}
