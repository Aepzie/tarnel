import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { AUDIO_IPC, EXTENSION_IPC, IPC, PANIC_IPC, type Unsubscribe, type VelaChromeAPI } from '../shared/ipc';
import { reportIdentityHints } from './identity-hints';
import { MIXER_IPC } from '../shared/audio-mixer';
import { VPN_IPC } from '../shared/vpn';
import { BATTERY_IPC } from '../shared/battery';
import { SITE_IPC } from '../shared/site-data';
import { TASK_MANAGER_IPC } from '../shared/task-manager';
import { BOOKMARKS_IPC } from '../shared/bookmarks-ipc';
import { PASSWORD_IPC } from '../shared/passwords';
import { SITE_RULES_IPC } from '../shared/site-rules';
import { PEEK_IPC } from '../shared/peek';
import { ALIAS_IPC } from '../shared/aliases';
import { TAB_ARCHIVE_IPC } from '../shared/tab-archive';

const C = IPC.chrome;
const E = IPC.chromeEvents;
const X = EXTENSION_IPC;

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: VelaChromeAPI = {
  getState: () => invoke(C.getState),
  onState: (cb) => subscribe(E.state, cb),
  onCommand: (cb) => subscribe(E.command, cb),
  onFindResult: (cb) => subscribe(E.findResult, cb),
  onDownload: (cb) => subscribe(E.download, cb),
  onPermission: (cb) => subscribe(E.permission, cb),
  onPermissionCancel: (cb) => subscribe(E.permissionCancel, cb),

  permissions: {
    respond: (id, allow, remember) => invoke(C.permissionRespond, id, allow, remember),
  },

  tabs: {
    create: (options) => invoke(C.tabCreate, options ?? {}),
    close: (id) => invoke(C.tabClose, id),
    activate: (id) => invoke(C.tabActivate, id),
    navigate: (id, input) => invoke(C.tabNavigate, id, input),
    back: (id) => invoke(C.tabBack, id),
    forward: (id) => invoke(C.tabForward, id),
    reload: (id, ignoreCache) => invoke(C.tabReload, id, ignoreCache === true),
    stop: (id) => invoke(C.tabStop, id),
    sleep: (id) => invoke(C.tabSleep, id),
    togglePin: (id) => invoke(C.tabTogglePin, id),
    toggleMute: (id) => invoke(C.tabToggleMute, id),
    move: (id, toIndex) => invoke(C.tabMove, id, toIndex),
    duplicate: (id) => invoke(C.tabDuplicate, id),
    moveToSpace: (id, spaceId) => invoke(C.tabMoveToSpace, id, spaceId),
    find: (id, text, forward) => invoke(C.tabFind, id, text, forward !== false),
    stopFind: (id) => invoke(C.tabStopFind, id),
    zoom: (id, delta) => invoke(C.tabZoom, id, delta),
  },

  groups: {
    create: (tabIds, input) => invoke(C.groupCreate, tabIds, input ?? {}),
    addTabs: (groupId, tabIds) => invoke(C.groupAddTabs, groupId, tabIds),
    removeTabs: (tabIds) => invoke(C.groupRemoveTabs, tabIds),
    update: (groupId, patch) => invoke(C.groupUpdate, groupId, patch),
    ungroup: (groupId) => invoke(C.groupUngroup, groupId),
    close: (groupId) => invoke(C.groupClose, groupId),
    move: (groupId, beforeTabId) => invoke(C.groupMove, groupId, beforeTabId),
    placeTab: (tabId, beforeTabId, groupId) => invoke(C.groupPlaceTab, tabId, beforeTabId, groupId),
    newTab: (groupId) => invoke(C.groupNewTab, groupId),
    setAllCollapsed: (collapsed) => invoke(C.groupSetAllCollapsed, collapsed),
  },

  spaces: {
    create: (input) => invoke(C.spaceCreate, input),
    update: (id, patch) => invoke(C.spaceUpdate, id, patch),
    remove: (id) => invoke(C.spaceRemove, id),
    activate: (id) => invoke(C.spaceActivate, id),
    regenerateFingerprint: (id) => invoke(C.spaceRegenerateFingerprint, id),
  },

  settings: {
    get: () => invoke(C.settingsGet),
    set: (patch) => invoke(C.settingsSet, patch),
    onChange: (cb) => subscribe(E.settings, cb),
  },

  perf: {
    get: () => invoke(C.perfGet),
  },

  suggest: (input) => invoke(C.suggest, input),
  preconnect: (url) => invoke(C.preconnect, url),

  downloads: {
    open: (id) => invoke(C.downloadOpen, id),
    show: (id) => invoke(C.downloadShow, id),
  },

  window: {
    minimize: () => invoke(C.windowMinimize),
    toggleMaximize: () => invoke(C.windowToggleMaximize),
    close: () => invoke(C.windowClose),
    isMaximized: () => invoke(C.windowIsMaximized),
    onMaximizedChange: (cb) => subscribe(E.maximized, cb),
  },

  ui: {
    setContentBounds: (bounds) => invoke(C.setContentBounds, bounds),
    setOverlay: (open) => invoke(C.setOverlay, open),
  },

  updates: {
    get: () => invoke(C.updateGet),
    onStatus: (cb) => subscribe(E.update, cb),
    download: () => invoke(C.updateDownload),
    install: () => invoke(C.updateInstall),
    openRelease: () => invoke(C.updateOpenRelease),
  },

  split: {
    create: (tabIds, focus) => invoke(C.splitCreate, tabIds, focus ?? null),
    add: (splitId, tabId, index) => invoke(C.splitAdd, splitId, tabId, index),
    separate: (tabId) => invoke(C.splitSeparate, tabId),
    close: (splitId) => invoke(C.splitClose, splitId),
    resize: (splitId, ratioX, ratioY, commit) => invoke(C.splitResize, splitId, ratioX, ratioY, commit),
    swap: (splitId) => invoke(C.splitSwap, splitId),
    toggle: () => invoke(C.splitToggle),
    peek: (open) => invoke(C.splitPeek, open),
    onHover: (cb) => subscribe(E.splitHover, cb),
  },

  platform: process.platform,

  extensions: {
    get: () => invoke(X.get),
    onChange: (cb) => subscribe(X.changed, cb),
    activate: (id, anchor, kind) => invoke(X.activate, id, anchor, kind ?? 'click'),
    setPinned: (id, pinned) => invoke(X.setPinned, id, pinned),
    openOptions: (id) => invoke(X.options, id),
  },

  panic: () => invoke(PANIC_IPC.run),

  mediaDevices: {
    set: (tabId, slot, choice) => invoke(AUDIO_IPC.setDevice, tabId, slot, choice),
  },
  mixer: {
    get: () => invoke(MIXER_IPC.get),
    onState: (cb) => subscribe(MIXER_IPC.stateEvent, cb),
    set: (tabId, patch) => invoke(MIXER_IPC.set, tabId, patch),
    reset: (tabId) => invoke(MIXER_IPC.reset, tabId),
    watchLevels: (on) => invoke(MIXER_IPC.watchLevels, on),
    onLevels: (cb) => subscribe(MIXER_IPC.levelsEvent, cb),
  },
  battery: {
    state: () => invoke(BATTERY_IPC.state),
    report: (level) => invoke(BATTERY_IPC.report, level),
    onChange: (cb) => subscribe(BATTERY_IPC.changed, cb),
  },
  vpn: {
    state: () => invoke(VPN_IPC.state),
    refresh: () => invoke(VPN_IPC.refresh),
    login: (accountNumber) => invoke(VPN_IPC.login, accountNumber),
    verifyTotp: (code) => invoke(VPN_IPC.verifyTotp, code),
    logout: () => invoke(VPN_IPC.logout),
    connect: (serverId) => invoke(VPN_IPC.connect, serverId),
    disconnect: () => invoke(VPN_IPC.disconnect),
    routeTab: (tabId, country) => invoke(VPN_IPC.routeTab, tabId, country),
    onState: (cb) => subscribe(VPN_IPC.changed, cb),
  },
  site: {
    info: (tabId) => invoke(SITE_IPC.info, tabId),
    clear: (tabId) => invoke(SITE_IPC.clear, tabId),
    resetPermission: (tabId, key) => invoke(SITE_IPC.resetPermission, tabId, key),
    setOnClose: (tabId, action) => invoke(SITE_IPC.setOnClose, tabId, action),
  },
  taskManager: {
    snapshot: () => invoke(TASK_MANAGER_IPC.snapshot),
    endProcess: (tabId) => invoke(TASK_MANAGER_IPC.endProcess, tabId),
  },
  bookmarks: {
    list: (spaceId) => invoke(BOOKMARKS_IPC.chromeList, spaceId ?? null),
    add: (input, spaceId) => invoke(BOOKMARKS_IPC.chromeAdd, input, spaceId ?? null),
    update: (id, patch, spaceId) => invoke(BOOKMARKS_IPC.chromeUpdate, id, patch, spaceId ?? null),
    remove: (id, spaceId) => invoke(BOOKMARKS_IPC.chromeRemove, id, spaceId ?? null),
    search: (query, limit, spaceId) => invoke(BOOKMARKS_IPC.chromeSearch, query, limit ?? null, spaceId ?? null),
    onChange: (cb) => subscribe(BOOKMARKS_IPC.changed, cb),
    openManager: () => invoke(BOOKMARKS_IPC.chromeOpenManager),
    },
  tabArchive: {
    list: (spaceId) => invoke(TAB_ARCHIVE_IPC.list, spaceId ?? null),
    archiveTabs: (tabIds) => invoke(TAB_ARCHIVE_IPC.archiveTabs, tabIds),
    archiveGroup: (groupId) => invoke(TAB_ARCHIVE_IPC.archiveGroup, groupId),
    restore: (ids, spaceId) => invoke(TAB_ARCHIVE_IPC.restore, ids, spaceId ?? null),
    remove: (ids, spaceId) => invoke(TAB_ARCHIVE_IPC.remove, ids, spaceId ?? null),
    clear: (spaceId) => invoke(TAB_ARCHIVE_IPC.clear, spaceId ?? null),
    reopenClosed: (id) => invoke(TAB_ARCHIVE_IPC.reopenClosed, id),
    onChange: (cb) => subscribe(TAB_ARCHIVE_IPC.changed, cb),
  },
  passwords: {
    onSavePrompt: (cb) => subscribe(PASSWORD_IPC.savePrompt, cb),
    onSaveCancel: (cb) => subscribe(PASSWORD_IPC.saveCancel, cb),
    answerSave: (id, answer) => invoke(PASSWORD_IPC.answerSave, id, answer),
    onFillOffer: (cb) => subscribe(PASSWORD_IPC.fillOffer, cb),
    onFillCancel: (cb) => subscribe(PASSWORD_IPC.fillCancel, cb),
    fill: (offerId, loginId) => invoke(PASSWORD_IPC.fill, offerId, loginId),
    dismissOffer: (offerId) => invoke(PASSWORD_IPC.dismissOffer, offerId),
  },
  siteRules: {
    createFor: (tabId) => invoke(SITE_RULES_IPC.chromeCreateFor, tabId),
    onNotice: (cb) => subscribe(SITE_RULES_IPC.notice, cb),
  },
  peek: {
    open: (input) => invoke(PEEK_IPC.open, input),
    close: () => invoke(PEEK_IPC.close),
    reveal: () => invoke(PEEK_IPC.reveal),
    back: () => invoke(PEEK_IPC.back),
    reload: () => invoke(PEEK_IPC.reload),
    toTab: () => invoke(PEEK_IPC.toTab),
    toSplit: () => invoke(PEEK_IPC.toSplit),
    onState: (cb) => subscribe(PEEK_IPC.changed, cb),
  },
  aliases: {
    onOffer: (cb) => subscribe(ALIAS_IPC.offer, cb),
    onOfferCancel: (cb) => subscribe(ALIAS_IPC.offerCancel, cb),
    create: (offerId) => invoke(ALIAS_IPC.create, offerId),
    dismiss: (offerId) => invoke(ALIAS_IPC.dismiss, offerId),
  },
};

contextBridge.exposeInMainWorld('vela', api);
reportIdentityHints();
