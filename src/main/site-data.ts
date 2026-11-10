import type { IpcMainInvokeEvent, Session, WebContents } from 'electron';
import {
  SITE_IPC,
  cleanSiteDataPolicy,
  clearsOnExit,
  clearsOnLastTab,
  originVariants,
  siteOverride,
  type SiteDataPolicy,
  type SiteInfo,
} from '../shared/site-data';
import type { SpaceId } from '../shared/types';
import { registrableDomain } from './net/domain';
import { listOriginDecisions, resetOriginDecision, type PermissionScope } from './permissions';
import { getSpace, getSpaceSession, listSpaces } from './spaces';
import { createStore, type JsonStore } from './store';
import { getBrowserState, getTabVpn, getTabWebContents, onStateChanged } from './tabs';

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;
type Policies = Record<SpaceId, SiteDataPolicy>;

/** Site data only; the HTTP cache is not "site data" (same as Chromium's "clear on exit"). */
const STORAGE_TYPES: NonNullable<Electron.ClearDataOptions['dataTypes']> = [
  'localStorage',
  'indexedDB',
  'serviceWorkers',
  'fileSystems',
  'webSQL',
  'backgroundFetch',
];
const LAST_TAB_DELAY_MS = 30_000;
const ESTIMATE_TIMEOUT_MS = 800;

let store: JsonStore<Policies> | null = null;
const lastTabTimers = new Map<string, NodeJS.Timeout>();
let openSites = new Set<string>();

function getStore(): JsonStore<Policies> {
  store ??= createStore<Policies>('site-data', {});
  return store;
}

export function getSiteDataPolicy(spaceId: SpaceId): SiteDataPolicy {
  return cleanSiteDataPolicy(getStore().get()[spaceId]);
}

function setSiteDataPolicy(spaceId: SpaceId, policy: SiteDataPolicy): SiteDataPolicy {
  const clean = cleanSiteDataPolicy(policy);
  getStore().update((current) => ({ ...current, [spaceId]: clean }));
  return clean;
}

function hostOf(url: string): { origin: string; host: string } | null {
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) return null;
    return { origin: parsed.origin, host: parsed.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

function siteOf(host: string): string {
  return registrableDomain(host) || host;
}

function tabSession(tabId: number, spaceId: SpaceId): Session {
  const wc = getTabWebContents(tabId);
  if (wc && !wc.isDestroyed()) return wc.session;
  return getSpaceSession(spaceId, getTabVpn(tabId));
}

function scopeFor(ses: Session, spaceId: SpaceId): PermissionScope {
  return { session: ses, spaceId, ephemeral: getSpace(spaceId)?.ephemeral ?? false };
}

function cookieUrl(cookie: Electron.Cookie): string {
  const domain = (cookie.domain ?? '').replace(/^\./, '');
  return `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path ?? '/'}`;
}

async function removeCookies(ses: Session, cookies: Electron.Cookie[]): Promise<void> {
  await Promise.all(cookies.map((cookie) => ses.cookies.remove(cookieUrl(cookie), cookie.name).catch(() => undefined)));
}

/** Cookies of the site (and its subdomains) plus storage of its usual origins. */
async function clearSite(ses: Session, site: string, extraOrigins: string[] = []): Promise<void> {
  const cookies = await ses.cookies.get({ domain: site }).catch(() => [] as Electron.Cookie[]);
  await removeCookies(ses, cookies);
  const origins = [...new Set([...extraOrigins, ...originVariants(site)])];
  await ses.clearData({ dataTypes: STORAGE_TYPES, origins }).catch(() => undefined);
  await ses.cookies.flushStore().catch(() => undefined);
}

async function storageEstimate(wc: WebContents | null): Promise<number | null> {
  if (!wc || wc.isDestroyed()) return null;
  const estimate = wc
    .executeJavaScriptInIsolatedWorld(1999, [{ code: 'navigator.storage.estimate().then((e) => e.usage ?? null)' }])
    .then((usage: unknown) => (typeof usage === 'number' && Number.isFinite(usage) ? usage : null))
    .catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ESTIMATE_TIMEOUT_MS));
  return Promise.race([estimate, timeout]);
}

function requireTab(tabId: number): { spaceId: SpaceId; url: string; secure: boolean; blockedCount: number } {
  const tab = getBrowserState().tabs.find((candidate) => candidate.id === tabId);
  if (!tab) throw new Error(`Unknown tab: ${tabId}`);
  return tab;
}

export async function getSiteInfo(tabId: number): Promise<SiteInfo | null> {
  const tab = requireTab(tabId);
  const address = hostOf(tab.url);
  const space = getSpace(tab.spaceId);
  if (!address || !space) return null;
  const site = siteOf(address.host);
  const ses = tabSession(tabId, tab.spaceId);
  const [cookies, storageBytes] = await Promise.all([
    ses.cookies.get({ domain: site }).catch(() => [] as Electron.Cookie[]),
    storageEstimate(getTabWebContents(tabId)),
  ]);
  const policy = getSiteDataPolicy(tab.spaceId);
  const override = siteOverride(policy, address.host);
  return {
    tabId,
    spaceId: space.id,
    spaceName: space.name,
    ephemeral: space.ephemeral,
    origin: address.origin,
    host: address.host,
    site,
    secure: tab.secure,
    blockedCount: tab.blockedCount,
    cookies: cookies.length,
    storageBytes,
    permissions: listOriginDecisions(scopeFor(ses, tab.spaceId), address.origin),
    onClose: clearsOnExit(policy, address.host) ? 'clear' : 'keep',
    overridden: override !== undefined,
  };
}

async function clearTabSite(tabId: number): Promise<SiteInfo | null> {
  const tab = requireTab(tabId);
  const address = hostOf(tab.url);
  if (!address) return null;
  await clearSite(tabSession(tabId, tab.spaceId), siteOf(address.host), [address.origin]);
  return getSiteInfo(tabId);
}

function resetTabPermission(tabId: number, key: unknown): Promise<SiteInfo | null> {
  const tab = requireTab(tabId);
  const address = hostOf(tab.url);
  if (!address || typeof key !== 'string') throw new TypeError('Invalid permission');
  resetOriginDecision(scopeFor(tabSession(tabId, tab.spaceId), tab.spaceId), address.origin, key);
  return getSiteInfo(tabId);
}

/** Per-site override from the panel; null drops it so the Space default applies. */
function setTabOnClose(tabId: number, action: unknown): Promise<SiteInfo | null> {
  if (action !== null && action !== 'keep' && action !== 'clear') throw new TypeError('Invalid action');
  const tab = requireTab(tabId);
  const address = hostOf(tab.url);
  if (!address) throw new Error('Not a website');
  const site = siteOf(address.host);
  const policy = getSiteDataPolicy(tab.spaceId);
  const sites = { ...policy.sites };
  for (const pattern of Object.keys(sites)) if (pattern === site || pattern === address.host) delete sites[pattern];
  if (action !== null) sites[site] = action;
  setSiteDataPolicy(tab.spaceId, { ...policy, sites });
  return getSiteInfo(tabId);
}

function listPolicies(): { spaceId: SpaceId; name: string; color: string; policy: SiteDataPolicy }[] {
  return listSpaces()
    .filter((space) => !space.ephemeral)
    .map((space) => ({ spaceId: space.id, name: space.name, color: space.color, policy: getSiteDataPolicy(space.id) }));
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Invalid id');
  return value;
}

function knownSpace(value: unknown): SpaceId {
  if (typeof value !== 'string' || !getSpace(value)) throw new Error('Unknown space');
  return value;
}

// ---------------------------------------------------------------------------
// "When the last tab of a site closes"

function siteKey(spaceId: SpaceId, site: string): string {
  return `${spaceId}\n${site}`;
}

function watchLastTabs(): void {
  onStateChanged(() => {
    const now = new Set<string>();
    for (const tab of getBrowserState().tabs) {
      const address = hostOf(tab.url);
      if (address) now.add(siteKey(tab.spaceId, siteOf(address.host)));
    }
    for (const key of now) {
      const timer = lastTabTimers.get(key);
      if (!timer) continue;
      clearTimeout(timer);
      lastTabTimers.delete(key);
    }
    for (const key of openSites) {
      if (now.has(key) || lastTabTimers.has(key)) continue;
      const [spaceId, site] = key.split('\n');
      if (!getSpace(spaceId) || !clearsOnLastTab(getSiteDataPolicy(spaceId), site)) continue;
      const timer = setTimeout(() => {
        lastTabTimers.delete(key);
        if (openSites.has(key) || !getSpace(spaceId)) return;
        void clearSite(getSpaceSession(spaceId), site).catch(() => undefined);
      }, LAST_TAB_DELAY_MS);
      timer.unref?.();
      lastTabTimers.set(key, timer);
    }
    openSites = now;
  });
}

// ---------------------------------------------------------------------------
// On quit

/** True when quitting has site data to delete (used to give the quit race more time). */
export function siteDataClearPending(): boolean {
  return listSpaces().some((space) => {
    if (space.ephemeral) return false;
    const policy = getSiteDataPolicy(space.id);
    return policy.clearOnExit || Object.values(policy.sites).includes('clear');
  });
}

async function clearSpaceOnQuit(spaceId: SpaceId, policy: SiteDataPolicy): Promise<void> {
  const ses = getSpaceSession(spaceId);
  if (!policy.clearOnExit) {
    const sites = Object.entries(policy.sites).filter(([, action]) => action === 'clear').map(([site]) => site);
    await Promise.all(sites.map((site) => clearSite(ses, site)));
    return;
  }
  const kept = Object.entries(policy.sites).filter(([, action]) => action === 'keep').map(([site]) => site);
  if (kept.length === 0) {
    await ses.clearData({ dataTypes: [...STORAGE_TYPES, 'cookies'] }).catch(() => undefined);
  } else {
    const cookies = await ses.cookies.get({}).catch(() => [] as Electron.Cookie[]);
    await removeCookies(ses, cookies.filter((cookie) => clearsOnExit(policy, cookie.domain ?? '')));
    const keptOrigins = new Set(kept.flatMap(originVariants));
    for (const tab of getBrowserState().tabs) {
      const address = tab.spaceId === spaceId ? hostOf(tab.url) : null;
      if (address && !clearsOnExit(policy, address.host)) keptOrigins.add(address.origin);
    }
    await ses.clearData({ dataTypes: STORAGE_TYPES, excludeOrigins: [...keptOrigins] }).catch(() => undefined);
  }
  await ses.cookies.flushStore().catch(() => undefined);
}

/** Runs inside the before-quit dispose race; ephemeral Spaces are wiped by their own disposal. */
export async function clearSiteDataOnQuit(): Promise<void> {
  for (const timer of lastTabTimers.values()) clearTimeout(timer);
  lastTabTimers.clear();
  const work = listSpaces()
    .filter((space) => !space.ephemeral)
    .map((space) => ({ id: space.id, policy: getSiteDataPolicy(space.id) }))
    .filter(({ policy }) => policy.clearOnExit || Object.values(policy.sites).includes('clear'))
    .map(({ id, policy }) => clearSpaceOnQuit(id, policy).catch(() => undefined));
  await Promise.all(work);
}

export function registerSiteDataIpc(handleChrome: ChromeHandler, handlePages: PagesHandler): void {
  watchLastTabs();
  handleChrome(SITE_IPC.info, (tabId) => getSiteInfo(int(tabId)));
  handleChrome(SITE_IPC.clear, (tabId) => clearTabSite(int(tabId)));
  handleChrome(SITE_IPC.resetPermission, (tabId, key) => resetTabPermission(int(tabId), key));
  handleChrome(SITE_IPC.setOnClose, (tabId, action) => setTabOnClose(int(tabId), action));
  handlePages(SITE_IPC.pagesPolicies, () => listPolicies());
  handlePages(SITE_IPC.pagesSetPolicy, (_event, spaceId, policy) => {
    setSiteDataPolicy(knownSpace(spaceId), cleanSiteDataPolicy(policy));
    return listPolicies();
  });
}

