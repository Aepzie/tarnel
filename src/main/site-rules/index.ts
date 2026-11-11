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
import { createTab, getTabSpaceId, getTabVpn, getTabWebContents, moveToSpace, navigateTab, onTabWebContents } from '../tabs';
import { canRouteTabs, routableCountries, routeTabByRule } from '../vpn';
import { sendToChrome } from '../window';
import { fingerprintOverrideOf, setFingerprintOverride, setUserAgentOverride, userAgentOverrideOf } from './overrides';
import { getSiteRules, setSiteRules } from './store';

/**
 * Applies site rules when a tab navigates top-level (link click, typed URL, new tab from a link):
 *   1. Block   → the navigation is cancelled.
 *   2. Space   → the tab moves to the target Space and loads the URL there (tabs.moveToSpace).
 *   3. VPN     → the tab is routed like the tab VPN menu does (needs a live MantelVPN session; else a hint).
 *   4. UA      → per-tab webContents.setUserAgent, then the navigation restarts so the request carries it.
 *   5. Fingerprint → a per-tab level read by the fingerprint config IPC ('random' = fresh seed per site visit).
 * Steps 2–4 re-enter this handler on the restarted navigation, which then finds nothing left to change.
 * Space and VPN stick after leaving the site (the tab now lives there); UA and fingerprint follow the site.
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

function stop(wc: WebContents, prevent?: () => void): void {
  if (prevent) prevent();
  else {
    try {
      wc.stop();
    } catch {
      /* destroyed meanwhile */
    }
  }
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

/** UA wanted for this navigation vs. what the tab has; true when the navigation must restart. */
function applyUserAgent(wc: WebContents, wanted: string | null): boolean {
  const current = userAgentOverrideOf(wc);
  if (wanted === current) return false;
  setUserAgentOverride(wc, wanted);
  try {
    wc.setUserAgent(wanted ?? wc.session.getUserAgent());
  } catch {
    return false;
  }
  return true;
}

/**
 * Decides what a top-level navigation to `url` in tab `tabId` needs. `prevent` cancels a
 * renderer-initiated navigation (will-navigate); otherwise the started navigation is stopped.
 */
function handleNavigation(wc: WebContents, tabId: number, url: string, prevent?: () => void): void {
  const rules = getSiteRules();
  if (rules.length === 0 && !fingerprintOverrideOf(wc) && !userAgentOverrideOf(wc)) return;
  const resolution = resolveSiteRules(rules, url);
  const host = resolution.host;

  if (resolution.block && host) {
    stop(wc, prevent);
    notify(tabId, `block:${host}:${Date.now()}`, `${host} is blocked by a site rule.`);
    return;
  }

  const spaceId = getTabSpaceId(tabId);
  if (resolution.space && spaceId && resolution.space !== spaceId && getSpace(resolution.space)) {
    const target = resolution.space;
    stop(wc, prevent);
    setImmediate(() => moveToSpace(tabId, target, url));
    return;
  }

  const country = resolution.vpn;
  if (country && host && getTabVpn(tabId) !== country) {
    const routeKey = `${country}:${host}`;
    if (!canRouteTabs()) {
      notify(tabId, `vpn:${routeKey}`, `Sign in to MantelVPN to route ${host} through ${country.toUpperCase()} (site rule).`);
    } else if (failedRoutes.get(tabId) !== routeKey) {
      stop(wc, prevent);
      void routeTabByRule(tabId, country).then(
        (result) => {
          if (!result.ok) {
            failedRoutes.set(tabId, routeKey);
            notify(tabId, `vpn-fail:${routeKey}`, result.error ?? 'The site rule could not route this tab through MantelVPN.');
          }
          navigateTab(tabId, url);
        },
        () => {
          failedRoutes.set(tabId, routeKey);
          navigateTab(tabId, url);
        },
      );
      return;
    }
  }

  applyFingerprint(wc, resolution);
  if (applyUserAgent(wc, resolution.userAgent)) {
    stop(wc, prevent);
    setImmediate(() => navigateTab(tabId, url));
  }
}

function watch(wc: WebContents, tabId: number): void {
  wc.on('will-navigate', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    handleNavigation(wc, tabId, details.url, () => details.preventDefault());
  });
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    handleNavigation(wc, tabId, details.url);
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
  const wc = getTabWebContents(rawTabId);
  const pattern = wc ? suggestPattern(wc.getURL()) : null;
  draftToken += 1;
  pendingDraft = pattern ? { pattern, token: draftToken } : null;
  createTab({ url: 'vela://settings/#rules', active: true, afterId: rawTabId });
}

export function initSiteRules(): void {
  onTabWebContents(watch);
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
