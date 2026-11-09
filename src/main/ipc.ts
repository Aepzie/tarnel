import { app, ipcMain, nativeTheme, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/ipc';
import { SPACE_COLORS, type ContentBounds, type Settings, type SpaceColor, type SpaceInput, type Suggestion, type TabGroupInput } from '../shared/types';
import { clearHistory, deleteHistoryEntry, listHistory, suggest, topSites } from './history';
import { getBlockedTotal } from './perf/adblock';
import { collectPerfStats } from './perf/metrics';
import { getSettings, updateSettings } from './settings';
import { clearSpaceData, createSpace, getActiveSpaceId, getSpace, getSpaceSession, listSpaces, updateSpace } from './spaces';
import * as tabs from './tabs';
import * as tabGroups from './tab-groups';
import { getCompletedDownloadPath, getDownloadPath } from './downloads';
import { forgetSpacePermissions, handlePermissionResponse } from './permissions';
import { resolveInput, resolveInputDetailed } from './url';
import { getChromeView, getMainWindow } from './window';

type Handler = (...args: unknown[]) => unknown;

const MAX_INPUT = 4096;
const MAX_ID = 128;

// ---------------------------------------------------------------------------
// argument validation

function int(value: unknown, name = 'id'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`Invalid ${name}`);
  return value;
}

function str(value: unknown, max = MAX_INPUT, name = 'string'): string {
  if (typeof value !== 'string' || value.length > max) throw new TypeError(`Invalid ${name}`);
  return value;
}

function optBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new TypeError('Invalid boolean');
  return value;
}

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid object');
  return value as Record<string, unknown>;
}

function spaceId(value: unknown): string {
  const id = str(value, MAX_ID, 'space id');
  if (!getSpace(id)) throw new Error(`Unknown space: ${id}`);
  return id;
}

function spaceInput(value: unknown): SpaceInput {
  const raw = plainObject(value);
  const input: SpaceInput = {
    name: str(raw.name, 64, 'name'),
    color: str(raw.color, 16, 'color') as SpaceColor,
    ephemeral: optBool(raw.ephemeral) ?? false,
  };
  if (!SPACE_COLORS.includes(input.color)) throw new TypeError('Invalid color');
  if (raw.proxy !== undefined) input.proxy = str(raw.proxy, 256, 'proxy');
  return input;
}

function spacePatch(value: unknown): Partial<SpaceInput> {
  const raw = plainObject(value);
  const patch: Partial<SpaceInput> = {};
  if (raw.name !== undefined) patch.name = str(raw.name, 64, 'name');
  if (raw.color !== undefined) {
    const color = str(raw.color, 16, 'color') as SpaceColor;
    if (!SPACE_COLORS.includes(color)) throw new TypeError('Invalid color');
    patch.color = color;
  }
  if (raw.proxy !== undefined) patch.proxy = str(raw.proxy, 256, 'proxy');
  return patch;
}

function tabIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 500) throw new TypeError('Invalid tab ids');
  return value.map((id) => int(id));
}

function groupId(value: unknown): string {
  const id = str(value, MAX_ID, 'group id');
  if (!tabGroups.getGroup(id)) throw new Error(`Unknown group: ${id}`);
  return id;
}

function optTabId(value: unknown): number | null {
  return value === null || value === undefined ? null : int(value);
}

function groupPatch(value: unknown): Partial<TabGroupInput> {
  const raw = value === undefined || value === null ? {} : plainObject(value);
  const patch: Partial<TabGroupInput> = {};
  if (raw.name !== undefined) patch.name = str(raw.name, 64, 'name');
  if (raw.color !== undefined) {
    const color = str(raw.color, 16, 'color') as SpaceColor;
    if (!SPACE_COLORS.includes(color)) throw new TypeError('Invalid color');
    patch.color = color;
  }
  if (raw.collapsed !== undefined) patch.collapsed = optBool(raw.collapsed);
  return patch;
}

function settingsPatch(value: unknown): Partial<Settings> {
  return plainObject(value) as Partial<Settings>;
}

function bounds(value: unknown): ContentBounds {
  const raw = plainObject(value);
  const num = (v: unknown): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 100_000) throw new TypeError('Invalid bounds');
    return v;
  };
  return { x: num(raw.x), y: num(raw.y), width: Math.max(0, num(raw.width)), height: Math.max(0, num(raw.height)) };
}

// ---------------------------------------------------------------------------
// sender authentication

function fromChrome(event: IpcMainInvokeEvent): boolean {
  const chrome = getChromeView()?.webContents;
  return !!chrome && event.sender === chrome;
}

function fromVelaPage(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = event.senderFrame;
  return !!frame && frame.parent === null && frame.url.startsWith('vela://') && tabs.tabIdForWebContents(event.sender.id) !== null;
}

function handleChrome(channel: string, fn: Handler): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromChrome(event)) throw new Error('Forbidden');
    return fn(...args);
  });
}

function handlePages(channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromVelaPage(event)) throw new Error('Forbidden');
    return fn(event, ...args);
  });
}

// ---------------------------------------------------------------------------
// shared handlers

function buildSuggestions(rawInput: unknown): Suggestion[] {
  const input = str(rawInput, MAX_INPUT, 'input').trim();
  if (!input) return [];
  const results: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (s: Suggestion): void => {
    const key = `${s.kind === 'tab' ? `tab:${s.tabId}` : s.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(s);
  };
  const resolved = resolveInputDetailed(input, getSettings().searchEngine);
  if (resolved) push({ kind: resolved.kind, title: input, url: resolved.url });
  for (const tab of tabs.searchOpenTabs(input, 3)) {
    push({ kind: 'tab', title: tab.title || tab.url, url: tab.url, tabId: tab.id });
  }
  for (const entry of suggest(input, 6)) push(entry);
  return results;
}

function perfStats() {
  const counts = tabs.countTabs();
  const chromePid = getChromeView()?.webContents.getOSProcessId();
  return collectPerfStats({
    tabsAwake: counts.awake,
    tabsAsleep: counts.asleep,
    blockedTotal: getBlockedTotal(),
    sleptRendererKB: counts.freedKB,
    uiRendererPids: chromePid ? [chromePid] : [],
  });
}

function preconnect(rawUrl: unknown): void {
  let url: URL;
  try {
    url = new URL(str(rawUrl, MAX_INPUT, 'url'));
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  getSpaceSession(getActiveSpaceId()).preconnect({ url: url.origin, numSockets: 1 });
}

async function removeSpace(id: unknown): Promise<void> {
  const target = spaceId(id);
  await tabs.removeSpaceWithTabs(target);
  forgetSpacePermissions(target);
}

function resolvedUrl(input: string): string {
  const url = resolveInput(input, getSettings().searchEngine);
  if (!url) throw new TypeError('Invalid url');
  return url;
}

/** Executables and scripts are never launched from the browser UI; the folder is shown instead. */
const DANGEROUS_EXT = /\.(exe|msi|msix|appx|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|jar|reg|cpl|dll|app|pkg|dmg|sh|command|run|appimage|deb|rpm)$/i;

const SPACE_HEX: Record<SpaceColor, string> = {
  slate: '#94a3b8',
  blue: '#60a5fa',
  violet: '#a78bfa',
  pink: '#f472b6',
  red: '#f87171',
  orange: '#fb923c',
  green: '#4ade80',
  teal: '#2dd4bf',
};

/**
 * Synchronous boot info for vela:// pages, read by the pages preload before first paint so pages
 * never flash the wrong theme or accent. Tiny and allocation-free on purpose (it blocks the renderer).
 */
function registerPagesBootSync(): void {
  ipcMain.on('pages:boot-sync', (event) => {
    if (!fromVelaPage(event)) {
      event.returnValue = null;
      return;
    }
    const { theme, newtabHero } = getSettings();
    const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
    const tabId = tabs.tabIdForWebContents(event.sender.id);
    const spaceId = tabId === null ? null : tabs.getTabSpaceId(tabId);
    const space = spaceId ? getSpace(spaceId) : undefined;
    event.returnValue = { theme: dark ? 'dark' : 'light', accent: space ? SPACE_HEX[space.color] : null, hero: newtabHero };
  });
}

export function registerIpc(): void {
  registerPagesBootSync();
  const c = IPC.chrome;
  handleChrome(c.getState, () => tabs.getBrowserState());
  handleChrome(c.tabCreate, (options) => {
    const opts = options === undefined || options === null ? {} : plainObject(options);
    return tabs.createTab({
      url: opts.url === undefined ? undefined : resolvedUrl(str(opts.url, MAX_INPUT, 'url')),
      spaceId: opts.spaceId === undefined ? undefined : spaceId(opts.spaceId),
      active: optBool(opts.active),
    });
  });
  handleChrome(c.tabClose, (id) => tabs.closeTab(int(id)));
  handleChrome(c.tabActivate, (id) => tabs.activateTab(int(id)));
  handleChrome(c.tabNavigate, (id, input) => tabs.navigateTab(int(id), str(input, MAX_INPUT, 'input')));
  handleChrome(c.tabBack, (id) => tabs.goBack(int(id)));
  handleChrome(c.tabForward, (id) => tabs.goForward(int(id)));
  handleChrome(c.tabReload, (id, ignoreCache) => tabs.reloadTab(int(id), optBool(ignoreCache) ?? false));
  handleChrome(c.tabStop, (id) => tabs.stopTab(int(id)));
  handleChrome(c.tabSleep, (id) => tabs.sleepTab(int(id)));
  handleChrome(c.tabTogglePin, (id) => tabs.togglePin(int(id)));
  handleChrome(c.tabToggleMute, (id) => tabs.toggleMute(int(id)));
  handleChrome(c.tabMove, (id, toIndex) => tabs.moveTab(int(id), int(toIndex, 'index')));
  handleChrome(c.tabDuplicate, (id) => tabs.duplicateTab(int(id)));
  handleChrome(c.tabMoveToSpace, (id, target) => tabs.moveToSpace(int(id), spaceId(target)));
  handleChrome(c.tabFind, (id, text, forward) => tabs.findInTab(int(id), str(text, 1000, 'text'), optBool(forward) ?? true));
  handleChrome(c.tabStopFind, (id) => tabs.stopFindInTab(int(id)));
  handleChrome(c.tabZoom, (id, delta) => tabs.zoomTab(int(id), Math.sign(int(delta, 'delta'))));
  handleChrome(c.groupCreate, (ids, input) => tabGroups.createGroup(tabIds(ids), groupPatch(input)));
  handleChrome(c.groupAddTabs, (id, ids) => tabGroups.addTabsToGroup(groupId(id), tabIds(ids)));
  handleChrome(c.groupRemoveTabs, (ids) => tabGroups.removeTabsFromGroups(tabIds(ids)));
  handleChrome(c.groupUpdate, (id, patch) => tabGroups.updateGroup(groupId(id), groupPatch(patch)));
  handleChrome(c.groupUngroup, (id) => tabGroups.ungroup(groupId(id)));
  handleChrome(c.groupClose, (id) => tabGroups.closeGroup(groupId(id)));
  handleChrome(c.groupMove, (id, before) => tabGroups.moveGroup(groupId(id), optTabId(before)));
  handleChrome(c.groupPlaceTab, (id, before, group) =>
    tabGroups.placeTab(int(id), optTabId(before), group === null || group === undefined ? null : groupId(group)),
  );
  handleChrome(c.groupNewTab, (id) => tabGroups.newTabInGroup(groupId(id)));
  handleChrome(c.groupSetAllCollapsed, (collapsed) => tabGroups.setAllGroupsCollapsed(optBool(collapsed) ?? true));
  handleChrome(c.spaceCreate, (input) => createSpace(spaceInput(input)));
  handleChrome(c.spaceUpdate, (id, patch) => updateSpace(spaceId(id), spacePatch(patch)));
  handleChrome(c.spaceRemove, removeSpace);
  handleChrome(c.spaceActivate, (id) => tabs.activateSpace(spaceId(id)));
  handleChrome(c.settingsGet, () => getSettings());
  handleChrome(c.settingsSet, (patch) => updateSettings(settingsPatch(patch)));
  handleChrome(c.perfGet, perfStats);
  handleChrome(c.suggest, buildSuggestions);
  handleChrome(c.preconnect, preconnect);
  handleChrome(c.windowMinimize, () => getMainWindow()?.minimize());
  handleChrome(c.windowToggleMaximize, () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  handleChrome(c.windowClose, () => getMainWindow()?.close());
  handleChrome(c.windowIsMaximized, () => getMainWindow()?.isMaximized() ?? false);
  handleChrome(c.setContentBounds, (rect) => tabs.setContentBounds(bounds(rect)));
  handleChrome(c.setOverlay, (open) => tabs.setOverlay(optBool(open) ?? false));
  handleChrome(c.downloadOpen, async (id) => {
    const path = getCompletedDownloadPath(str(id, MAX_ID, 'download id'));
    if (!path) return;
    if (DANGEROUS_EXT.test(path)) shell.showItemInFolder(path);
    else await shell.openPath(path);
  });
  handleChrome(c.downloadShow, (id) => {
    const path = getDownloadPath(str(id, MAX_ID, 'download id'));
    if (path) shell.showItemInFolder(path);
  });
  handleChrome(c.permissionRespond, (id, allow, remember) => {
    if (typeof allow !== 'boolean' || typeof remember !== 'boolean') throw new TypeError('Invalid permission response');
    handlePermissionResponse(str(id, MAX_ID, 'permission id'), allow, remember);
  });

  const p = IPC.pages;
  handlePages(p.getSettings, () => getSettings());
  handlePages(p.setSettings, (_e, patch) => updateSettings(settingsPatch(patch)));
  handlePages(p.topSites, () => topSites(8));
  handlePages(p.perf, perfStats);
  handlePages(p.listSpaces, () => listSpaces());
  handlePages(p.createSpace, (_e, input) => createSpace(spaceInput(input)));
  handlePages(p.updateSpace, (_e, id, patch) => updateSpace(spaceId(id), spacePatch(patch)));
  handlePages(p.removeSpace, (_e, id) => removeSpace(id));
  handlePages(p.clearSpaceData, async (_e, id) => {
    const target = spaceId(id);
    await clearSpaceData(target);
    forgetSpacePermissions(target);
  });
  handlePages(p.clearHistory, () => clearHistory());
  handlePages(p.history, (_e, query, limit, before) => {
    const max = int(limit, 'limit');
    if (max < 1 || max > 200) throw new TypeError('Invalid limit');
    if (before !== undefined && before !== null && (typeof before !== 'number' || !Number.isFinite(before))) {
      throw new TypeError('Invalid cursor');
    }
    return listHistory(str(query, 200, 'query'), max, typeof before === 'number' ? before : undefined);
  });
  handlePages(p.historyDelete, (_e, url) => deleteHistoryEntry(str(url, MAX_INPUT, 'url')));
  handlePages(p.navigate, (event, input) => {
    const tabId = tabs.tabIdForWebContents(event.sender.id);
    if (tabId !== null) tabs.navigateTab(tabId, str(input, MAX_INPUT, 'input'));
  });
  handlePages(p.currentSpace, (event) => {
    const tabId = tabs.tabIdForWebContents(event.sender.id);
    const id = tabId === null ? null : tabs.getTabSpaceId(tabId);
    return id ? (getSpace(id) ?? null) : null;
  });
  handlePages(p.version, () => ({
    app: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    v8: process.versions.v8 ?? '',
  }));
}
