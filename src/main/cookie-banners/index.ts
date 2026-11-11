import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type Session } from 'electron';
import path from 'node:path';
import {
  COOKIE_BANNER_IPC,
  cleanExceptions,
  isExcepted,
  parseDoneReport,
  siteKeyOf,
  type CookieBannerStats,
  type CookieBannerTabInfo,
} from '../../shared/cookie-banners';
import { getSettings, onSettingsChanged } from '../settings';
import { onSessionCreated, onSessionRemoved } from '../spaces';
import { createStore, type JsonStore } from '../store';
import { getTabWebContents, onTabWebContents, tabIdForWebContents } from '../tabs';

/**
 * Cookie banner auto-reject (docs/ARCHITECTURE.md → Cookie banners). Built on DuckDuckGo's
 * autoconsent (MPL-2.0) with its rule list bundled at build time:
 *  - a session preload (src/preload/cookie-banners.ts) runs in every web frame of every Space
 *    (VPN-routed sessions included), in the isolated world;
 *  - it asks main once per frame for rules; main answers null when the setting is off or the site
 *    is an exception, otherwise only the rules that can match that frame's URL;
 *  - the preload reports handled banners back; counts stay in memory (per tab + per site) and are
 *    exposed through getCookieBannerStats(). No page data leaves the machine.
 */

const PRELOAD = path.join(__dirname, '..', 'preload', 'cookie-banners.js');
const PRELOAD_ID = 'vela-cookie-banners';

type RulesModule = typeof import('./rules');
type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

interface ExceptionFile {
  exceptions: string[];
}

let rulesModule: RulesModule | null = null;
let store: JsonStore<ExceptionFile> | null = null;
const tabCounts = new Map<number, number>();
const siteCounts = new Map<string, number>();
let total = 0;
let cosmetic = 0;
const sessions = new Set<Session>();

function rules(): RulesModule {
  rulesModule ??= require(path.join(__dirname, 'cookie-banners.js')) as RulesModule;
  return rulesModule;
}

function getStore(): JsonStore<ExceptionFile> {
  store ??= createStore<ExceptionFile>('cookie-banners', { exceptions: [] });
  return store;
}

function exceptions(): string[] {
  return cleanExceptions(getStore().get().exceptions);
}

/** Allowing adds the site; disallowing removes every entry that covers it (e.g. a parent domain). */
function setException(site: string, allowed: boolean): void {
  const current = exceptions().filter((entry) => !isExcepted(site, [entry]));
  getStore().set({ exceptions: cleanExceptions(allowed ? [...current, site] : current) });
}

function webUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  return /^https?:/i.test(raw) ? raw : null;
}

/** The tab's top-level page: exceptions and counts belong to the site the user sees, not to an embedded CMP frame. */
function topSite(event: IpcMainEvent | IpcMainInvokeEvent): { tabId: number; site: string } | null {
  const tabId = tabIdForWebContents(event.sender.id);
  if (tabId === null) return null;
  const site = siteKeyOf(webUrl(event.sender.getURL()) ?? '');
  return site ? { tabId, site } : null;
}

function frameInit(event: IpcMainInvokeEvent): unknown {
  if (!getSettings().rejectCookieBanners) return null;
  const frame = event.senderFrame;
  const url = webUrl(frame?.url);
  if (!frame || !url) return null;
  const top = topSite(event);
  if (!top || isExcepted(top.site, exceptions())) return null;
  const mod = rules();
  return { config: mod.AUTOCONSENT_CONFIG, rules: mod.rulesFor(url, frame.parent === null) };
}

function frameDone(event: IpcMainEvent, raw: unknown): void {
  const report = parseDoneReport(raw);
  const top = topSite(event);
  if (!report || !top) return;
  total += 1;
  if (report.cosmetic) cosmetic += 1;
  tabCounts.set(top.tabId, (tabCounts.get(top.tabId) ?? 0) + 1);
  siteCounts.set(top.site, (siteCounts.get(top.site) ?? 0) + 1);
}

/** Session-wide counters for the privacy report (in memory only; nothing is persisted or sent anywhere). */
export function getCookieBannerStats(): CookieBannerStats {
  return { total, cosmetic, byTab: Object.fromEntries(tabCounts), bySite: Object.fromEntries(siteCounts) };
}

function tabInfo(tabId: number): CookieBannerTabInfo {
  const wc = getTabWebContents(tabId);
  const site = wc ? siteKeyOf(webUrl(wc.getURL()) ?? '') : null;
  return {
    enabled: getSettings().rejectCookieBanners,
    site,
    allowed: site ? isExcepted(site, exceptions()) : false,
    handled: tabCounts.get(tabId) ?? 0,
  };
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Invalid id');
  return value;
}

/** The preload is registered only while the setting is on: zero per-frame cost when it is off. */
function syncPreload(session: Session, on: boolean): void {
  try {
    const registered = session.getPreloadScripts().some((script) => script.id === PRELOAD_ID);
    if (on && !registered) session.registerPreloadScript({ id: PRELOAD_ID, type: 'frame', filePath: PRELOAD });
    if (!on && registered) session.unregisterPreloadScript(PRELOAD_ID);
  } catch {
    /* session gone */
  }
}

export function initCookieBanners(): void {
  ipcMain.handle(COOKIE_BANNER_IPC.frameInit, (event) => {
    try {
      return frameInit(event);
    } catch {
      return null;
    }
  });
  ipcMain.on(COOKIE_BANNER_IPC.frameDone, (event, raw: unknown) => {
    try {
      frameDone(event, raw);
    } catch {
      /* ignore malformed reports */
    }
  });
  onSessionCreated((session) => {
    sessions.add(session);
    syncPreload(session, getSettings().rejectCookieBanners);
  });
  onSessionRemoved((session) => sessions.delete(session));
  let enabled = getSettings().rejectCookieBanners;
  onSettingsChanged((settings) => {
    if (settings.rejectCookieBanners === enabled) return;
    enabled = settings.rejectCookieBanners;
    for (const session of sessions) syncPreload(session, enabled);
  });
  onTabWebContents((wc, tabId) => {
    wc.on('did-navigate', () => tabCounts.delete(tabId));
    wc.once('destroyed', () => tabCounts.delete(tabId));
  });
}

export function registerCookieBannerIpc(handleChrome: ChromeHandler, handlePages: PagesHandler): void {
  handleChrome(COOKIE_BANNER_IPC.tabInfo, (tabId) => tabInfo(int(tabId)));
  handleChrome(COOKIE_BANNER_IPC.setAllowed, (tabId, allowed) => {
    const id = int(tabId);
    if (typeof allowed !== 'boolean') throw new TypeError('Invalid value');
    const site = tabInfo(id).site;
    if (!site) throw new Error('Not a web page');
    setException(site, allowed);
    return tabInfo(id);
  });
  handlePages(COOKIE_BANNER_IPC.pagesList, () => exceptions());
  handlePages(COOKIE_BANNER_IPC.pagesRemove, (_event, site) => {
    const key = typeof site === 'string' ? siteKeyOf(site) : null;
    if (!key) throw new TypeError('Invalid site');
    setException(key, false);
    return exceptions();
  });
}
