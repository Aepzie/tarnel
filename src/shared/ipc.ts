import type {
  BrowserState,
  ContentBounds,
  DownloadState,
  FindResult,
  HistoryEntry,
  PerfStats,
  PermissionRequest,
  Settings,
  Space,
  SpaceId,
  SpaceInput,
  Suggestion,
  TabGroupId,
  TabGroupInput,
  TopSite,
  UICommand,
} from './types';

/**
 * IPC channel names. Chrome-UI channels are only accepted from the browser
 * chrome webContents. Pages channels are only accepted from vela:// frames.
 */
export const IPC = {
  chrome: {
    getState: 'chrome:get-state',
    tabCreate: 'chrome:tab-create',
    tabClose: 'chrome:tab-close',
    tabActivate: 'chrome:tab-activate',
    tabNavigate: 'chrome:tab-navigate',
    tabBack: 'chrome:tab-back',
    tabForward: 'chrome:tab-forward',
    tabReload: 'chrome:tab-reload',
    tabStop: 'chrome:tab-stop',
    tabSleep: 'chrome:tab-sleep',
    tabTogglePin: 'chrome:tab-toggle-pin',
    tabToggleMute: 'chrome:tab-toggle-mute',
    tabMove: 'chrome:tab-move',
    tabDuplicate: 'chrome:tab-duplicate',
    tabMoveToSpace: 'chrome:tab-move-to-space',
    tabFind: 'chrome:tab-find',
    tabStopFind: 'chrome:tab-stop-find',
    tabZoom: 'chrome:tab-zoom',
    spaceCreate: 'chrome:space-create',
    spaceUpdate: 'chrome:space-update',
    spaceRemove: 'chrome:space-remove',
    spaceActivate: 'chrome:space-activate',
    settingsGet: 'chrome:settings-get',
    settingsSet: 'chrome:settings-set',
    perfGet: 'chrome:perf-get',
    suggest: 'chrome:suggest',
    preconnect: 'chrome:preconnect',
    windowMinimize: 'chrome:window-minimize',
    windowToggleMaximize: 'chrome:window-toggle-maximize',
    windowClose: 'chrome:window-close',
    windowIsMaximized: 'chrome:window-is-maximized',
    setContentBounds: 'chrome:set-content-bounds',
    setOverlay: 'chrome:set-overlay',
    downloadOpen: 'chrome:download-open',
    downloadShow: 'chrome:download-show',
    permissionRespond: 'chrome:permission-respond',
    groupCreate: 'chrome:group-create',
    groupAddTabs: 'chrome:group-add-tabs',
    groupRemoveTabs: 'chrome:group-remove-tabs',
    groupUpdate: 'chrome:group-update',
    groupUngroup: 'chrome:group-ungroup',
    groupClose: 'chrome:group-close',
    groupMove: 'chrome:group-move',
    groupPlaceTab: 'chrome:group-place-tab',
    groupNewTab: 'chrome:group-new-tab',
    groupSetAllCollapsed: 'chrome:group-set-all-collapsed',
  },
  chromeEvents: {
    state: 'chrome-event:state',
    settings: 'chrome-event:settings',
    command: 'chrome-event:command',
    findResult: 'chrome-event:find-result',
    maximized: 'chrome-event:maximized',
    download: 'chrome-event:download',
    permission: 'chrome-event:permission',
    permissionCancel: 'chrome-event:permission-cancel',
  },
  pages: {
    getSettings: 'pages:get-settings',
    setSettings: 'pages:set-settings',
    topSites: 'pages:top-sites',
    perf: 'pages:perf',
    listSpaces: 'pages:list-spaces',
    createSpace: 'pages:create-space',
    updateSpace: 'pages:update-space',
    removeSpace: 'pages:remove-space',
    clearSpaceData: 'pages:clear-space-data',
    clearHistory: 'pages:clear-history',
    navigate: 'pages:navigate',
    version: 'pages:version',
    currentSpace: 'pages:current-space',
    history: 'pages:history',
    historyDelete: 'pages:history-delete',
  },
} as const;

export type Unsubscribe = () => void;

export interface CreateTabOptions {
  url?: string;
  spaceId?: SpaceId;
  active?: boolean;
}

/** Exposed as `window.vela` in the browser chrome (sidebar UI) via preload/chrome.ts. */
export interface VelaChromeAPI {
  getState(): Promise<BrowserState>;
  onState(cb: (state: BrowserState) => void): Unsubscribe;
  onCommand(cb: (command: UICommand) => void): Unsubscribe;
  onFindResult(cb: (result: FindResult) => void): Unsubscribe;
  onDownload(cb: (download: DownloadState) => void): Unsubscribe;
  /** A site asks for a permission; answer with permissions.respond(). */
  onPermission(cb: (request: PermissionRequest) => void): Unsubscribe;
  /** A pending request was withdrawn (tab closed/navigated, timed out). */
  onPermissionCancel(cb: (id: string) => void): Unsubscribe;

  permissions: {
    /** remember = persist the decision for this origin in this Space (non-burner spaces only). */
    respond(id: string, allow: boolean, remember: boolean): Promise<void>;
  };

  tabs: {
    create(options?: CreateTabOptions): Promise<number>;
    close(id: number): Promise<void>;
    activate(id: number): Promise<void>;
    /** `input` is raw address-bar text; main resolves URL vs. search. */
    navigate(id: number, input: string): Promise<void>;
    back(id: number): Promise<void>;
    forward(id: number): Promise<void>;
    reload(id: number, ignoreCache?: boolean): Promise<void>;
    stop(id: number): Promise<void>;
    sleep(id: number): Promise<void>;
    togglePin(id: number): Promise<void>;
    toggleMute(id: number): Promise<void>;
    move(id: number, toIndex: number): Promise<void>;
    duplicate(id: number): Promise<number>;
    moveToSpace(id: number, spaceId: SpaceId): Promise<void>;
    find(id: number, text: string, forward?: boolean): Promise<void>;
    stopFind(id: number): Promise<void>;
    /** delta: +1 / -1 step, 0 = reset to 100%. */
    zoom(id: number, delta: number): Promise<void>;
  };

  /** Tab groups. Tabs to group must share a Space; pinned tabs are unpinned when grouped. */
  groups: {
    create(tabIds: number[], input?: Partial<TabGroupInput>): Promise<TabGroupId>;
    addTabs(groupId: TabGroupId, tabIds: number[]): Promise<void>;
    removeTabs(tabIds: number[]): Promise<void>;
    update(groupId: TabGroupId, patch: Partial<TabGroupInput>): Promise<void>;
    /** Dissolve the group, keeping its tabs where they are. */
    ungroup(groupId: TabGroupId): Promise<void>;
    /** Close every tab of the group. */
    close(groupId: TabGroupId): Promise<void>;
    /** Move the whole group before `beforeTabId` (null = end of its space). */
    move(groupId: TabGroupId, beforeTabId: number | null): Promise<void>;
    /** Drag & drop: place a tab before `beforeTabId` (null = end) as a member of `groupId` (null = ungrouped). */
    placeTab(tabId: number, beforeTabId: number | null, groupId: TabGroupId | null): Promise<void>;
    newTab(groupId: TabGroupId): Promise<number>;
    /** Collapse or expand every group of the active space. */
    setAllCollapsed(collapsed: boolean): Promise<void>;
  };

  spaces: {
    create(input: SpaceInput): Promise<Space>;
    update(id: SpaceId, patch: Partial<SpaceInput>): Promise<Space>;
    remove(id: SpaceId): Promise<void>;
    activate(id: SpaceId): Promise<void>;
  };

  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    onChange(cb: (settings: Settings) => void): Unsubscribe;
  };

  perf: {
    get(): Promise<PerfStats>;
  };

  suggest(input: string): Promise<Suggestion[]>;
  preconnect(url: string): Promise<void>;

  downloads: {
    open(id: string): Promise<void>;
    show(id: string): Promise<void>;
  };

  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (maximized: boolean) => void): Unsubscribe;
  };

  ui: {
    /** Rect (CSS px, relative to window) where the active page view should be placed. */
    setContentBounds(bounds: ContentBounds): Promise<void>;
    /** true = chrome UI is raised above the page view (palette/menus open). */
    setOverlay(open: boolean): Promise<void>;
  };

  platform: NodeJS.Platform;
}

/** Exposed as `window.velaPages` only on vela:// pages via preload/pages.ts. */
export interface VelaPagesAPI {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  topSites(): Promise<TopSite[]>;
  perf(): Promise<PerfStats>;
  listSpaces(): Promise<Space[]>;
  createSpace(input: SpaceInput): Promise<Space>;
  updateSpace(id: SpaceId, patch: Partial<SpaceInput>): Promise<Space>;
  removeSpace(id: SpaceId): Promise<void>;
  clearSpaceData(id: SpaceId): Promise<void>;
  clearHistory(): Promise<void>;
  /** Navigate the tab hosting this page (address-bar semantics). */
  navigate(input: string): Promise<void>;
  version(): Promise<{ app: string; electron: string; chrome: string; v8: string }>;
  /** The Space owning the tab that hosts this page (for accent color etc.). */
  currentSpace(): Promise<Space | null>;
  /** Newest first. `query` filters url+title; `before` = lastVisit cursor for paging. */
  history(query: string, limit: number, before?: number): Promise<HistoryEntry[]>;
  /** Remove one URL from history. */
  deleteHistory(url: string): Promise<void>;
}

declare global {
  interface Window {
    vela: VelaChromeAPI;
    velaPages: VelaPagesAPI;
  }
}
