import type { PrivacyReport } from './privacy-report';
import type {
  BrowserState,
  ContentBounds,
  DownloadState,
  FindResult,
  FrameRateStatus,
  HistoryEntry,
  PerfStats,
  PermissionRequest,
  Settings,
  Space,
  SpaceId,
  SpaceInput,
  SplitId,
  Suggestion,
  TabGroupId,
  TabGroupInput,
  SyncCategories,
  SyncSetupInput,
  SyncStatus,
  SyncTransportInput,
  TopSite,
  UICommand,
  UpdateStatus,
} from './types';
import type { ExtensionAnchor, ExtensionInfo, ExtensionPatch, ExtensionReview, ExtensionsState } from './types';
import type { MediaDeviceChoice, MediaDeviceSlot } from './types';
import type { MixerTabState, TabAudioLevel, TabAudioSettings } from './audio-mixer';
import type { VpnResult, VpnState } from './vpn';
import type { BatterySaverState } from './battery';
import type { SiteCloseAction, SiteDataPolicy, SiteInfo, SitePermissionKey } from './site-data';
import type { TaskSnapshot } from './task-manager';
import type { AliasOffer, AliasOptions, AliasSettingsPatch, AliasSettingsView } from './aliases';
import type { PasswordFillOffer, PasswordSaveAnswer, PasswordSavePrompt, PasswordsStatus, SavedLogin, SavedLoginPatch } from './passwords';

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
    spaceRegenerateFingerprint: 'chrome:space-regenerate-fingerprint',
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
    updateGet: 'chrome:update-get',
    updateDownload: 'chrome:update-download',
    updateInstall: 'chrome:update-install',
    updateOpenRelease: 'chrome:update-open-release',
    splitCreate: 'chrome:split-create',
    splitAdd: 'chrome:split-add',
    splitSeparate: 'chrome:split-separate',
    splitClose: 'chrome:split-close',
    splitResize: 'chrome:split-resize',
    splitSwap: 'chrome:split-swap',
    splitToggle: 'chrome:split-toggle',
    splitPeek: 'chrome:split-peek',
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
    update: 'chrome-event:update',
    splitHover: 'chrome-event:split-hover',
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
    regenerateFingerprint: 'pages:regenerate-fingerprint',
    clearHistory: 'pages:clear-history',
    navigate: 'pages:navigate',
    version: 'pages:version',
    currentSpace: 'pages:current-space',
    history: 'pages:history',
    historyDelete: 'pages:history-delete',
    syncStatus: 'pages:sync-status',
    syncPickFolder: 'pages:sync-pick-folder',
    syncProbe: 'pages:sync-probe',
    syncEnable: 'pages:sync-enable',
    syncSetCategories: 'pages:sync-set-categories',
    syncNow: 'pages:sync-now',
    syncRecoveryKey: 'pages:sync-recovery-key',
    syncDisconnect: 'pages:sync-disconnect',
    updateGet: 'pages:update-get',
    updateWatch: 'pages:update-watch',
    updateCheck: 'pages:update-check',
    updateDownload: 'pages:update-download',
    updateInstall: 'pages:update-install',
    updateOpenRelease: 'pages:update-open-release',
    frameRate: 'pages:frame-rate',
    relaunch: 'pages:relaunch',
  },
  pagesEvents: {
    update: 'pages-event:update',
    theme: 'pages-event:theme',
  },
} as const;

export type Unsubscribe = () => void;

/** Auto-update controls shared by the chrome (`vela.updates`) and settings (`velaPages.updates`). */
export interface VelaUpdatesAPI {
  get(): Promise<UpdateStatus>;
  onStatus(cb: (status: UpdateStatus) => void): Unsubscribe;
  /** Start downloading an available update (install mode only). */
  download(): Promise<void>;
  /** Save the session, quit and run the downloaded installer. */
  install(): Promise<void>;
  /** Open the release page of the available version in a new tab. */
  openRelease(): Promise<void>;
}

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
    /** New random fingerprint seed; applies to pages loaded afterwards. */
    regenerateFingerprint(id: SpaceId): Promise<void>;
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

  updates: VelaUpdatesAPI;

  /** Split view (see docs/ARCHITECTURE.md → Split view). The focused pane is the active tab. */
  split: {
    /** Show 2–4 tabs of one Space side by side (pane order); returns null when invalid. */
    create(tabIds: number[], focus?: number): Promise<SplitId | null>;
    /** Add a tab as a pane at `index` (max 4 panes). */
    add(splitId: SplitId, tabId: number, index: number): Promise<void>;
    /** Take one tab out of its split. */
    separate(tabId: number): Promise<void>;
    close(splitId: SplitId): Promise<void>;
    /** Divider drag: live (commit=false) moves the page views only; commit persists. */
    resize(splitId: SplitId, ratioX: number, ratioY: number, commit: boolean): Promise<void>;
    swap(splitId: SplitId): Promise<void>;
    /** Close the split on screen, or split the active tab with the last used one. Returns a newly created tab. */
    toggle(): Promise<number | null>;
    /** Raise the chrome over the pages without taking focus (pane toolbar). */
    peek(open: boolean): Promise<void>;
    /** The pointer entered (tab id) / left (null) a pane's toolbar hot zone. */
    onHover(cb: (tabId: number | null) => void): Unsubscribe;
  };

  platform: NodeJS.Platform;
}

/** Exposed as `window.velaPages` only on vela:// pages via preload/pages.ts. */
export interface VelaPagesAPI {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  topSites(): Promise<TopSite[]>;
  perf(): Promise<PerfStats>;
  /** Displays, their refresh rates and what Vela paces frames to (Settings → Performance). */
  frameRate(): Promise<FrameRateStatus>;
  /** Restart Vela (applies launch-time settings such as the frame rate). */
  relaunch(): Promise<void>;
  listSpaces(): Promise<Space[]>;
  createSpace(input: SpaceInput): Promise<Space>;
  updateSpace(id: SpaceId, patch: Partial<SpaceInput>): Promise<Space>;
  removeSpace(id: SpaceId): Promise<void>;
  clearSpaceData(id: SpaceId): Promise<void>;
  regenerateFingerprint(id: SpaceId): Promise<void>;
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
  /** Optional end-to-end encrypted sync (see docs/ARCHITECTURE.md → Sync). */
  sync: {
    status(): Promise<SyncStatus>;
    /** Native folder picker; null when cancelled. */
    pickFolder(): Promise<string | null>;
    /** Whether the location already holds Vela sync data (→ join instead of create). */
    probe(transport: SyncTransportInput): Promise<{ exists: boolean }>;
    enable(input: SyncSetupInput): Promise<SyncStatus>;
    setCategories(categories: SyncCategories): Promise<SyncStatus>;
    now(): Promise<SyncStatus>;
    recoveryKey(): Promise<string>;
    /** wipeRemote also deletes the encrypted data at the remote for every device. */
    disconnect(wipeRemote: boolean): Promise<SyncStatus>;
  };
  updates: VelaUpdatesAPI & {
    /** Check now; resolves when the check finished (status carries the result). */
    check(): Promise<void>;
  };
  /** Local privacy report (vela://privacy, start-page stat line). */
  privacyReport: {
    get(): Promise<PrivacyReport>;
    reset(): Promise<void>;
  };
}

declare global {
  interface Window {
    vela: VelaChromeAPI;
    velaPages: VelaPagesAPI;
  }
}

/** Extension channels (chrome:* only from the chrome UI, pages:* only from vela:// pages). */
export const EXTENSION_IPC = {
  get: 'chrome:extensions-get',
  activate: 'chrome:extension-activate',
  setPinned: 'chrome:extension-set-pinned',
  options: 'chrome:extension-options',
  changed: 'chrome-event:extensions',
  list: 'pages:extensions-list',
  install: 'pages:extension-install',
  loadUnpacked: 'pages:extension-load-unpacked',
  update: 'pages:extension-update',
  reload: 'pages:extension-reload',
  remove: 'pages:extension-remove',
  pageOptions: 'pages:extension-options',
  confirmInstall: 'pages:extension-confirm-install',
  cancelInstall: 'pages:extension-cancel-install',
} as const;

export const PANIC_IPC = {
  run: 'chrome:panic',
} as const;

/** Panic button: wipe Burners, mute, drop VPN routes, hide the window. See src/main/panic.ts. */
export interface VelaChromeAPI {
  panic(): Promise<void>;
}

export interface VelaChromeAPI {
  extensions: {
    get(): Promise<ExtensionsState>;
    onChange(cb: (state: ExtensionsState) => void): Unsubscribe;
    /** Click (popup / onClicked) or context menu on an extension action, anchored at `anchor`. */
    activate(id: string, anchor: ExtensionAnchor, kind?: 'click' | 'contextmenu'): Promise<void>;
    setPinned(id: string, pinned: boolean): Promise<void>;
    openOptions(id: string): Promise<void>;
  };
}

/** Phishing & malware protection (vela:// pages only). */
export const SAFETY_IPC = {
  status: 'pages:safety-status',
  proceed: 'pages:safety-proceed',
} as const;

export interface SafetyStatus {
  enabled: boolean;
  /** Entries (hosts + URLs) currently loaded. */
  entries: number;
  /** Newest successful list download, epoch ms; null before the first one. */
  updatedAt: number | null;
  sources: { name: string; license: string; entries: number }[];
}

export interface VelaPagesAPI {
  safety: {
    status(): Promise<SafetyStatus>;
    /** Allowlist the URL's host until Vela quits (warning page → "Proceed anyway"). */
    proceed(url: string): Promise<void>;
  };
}

/** Per-tab media devices (chrome only). */
export const AUDIO_IPC = {
  setDevice: 'chrome:tab-set-media-device',
} as const;

export interface VelaChromeAPI {
  mediaDevices: {
    /** Route one slot of a tab to `choice`; null = back to "System default". Applies live. */
    set(tabId: number, slot: MediaDeviceSlot, choice: MediaDeviceChoice | null): Promise<void>;
  };
}

export interface VelaPagesAPI {
  extensions: {
    list(): Promise<ExtensionInfo[]>;
    /** Chrome Web Store URL or 32-letter extension ID. Downloads and stages it for review. */
    install(input: string): Promise<ExtensionReview>;
    /** Opens a folder picker and stages the folder for review; null when cancelled. */
    loadUnpacked(): Promise<ExtensionReview | null>;
    /** Adds a reviewed extension. */
    confirmInstall(token: string): Promise<ExtensionInfo>;
    /** Drops a staged extension (deletes downloaded store files). */
    cancelInstall(token: string): Promise<void>;
    update(id: string, patch: ExtensionPatch): Promise<ExtensionInfo>;
    reload(id: string): Promise<ExtensionInfo>;
    remove(id: string): Promise<void>;
    openOptions(id: string): Promise<void>;
  };
}

/** Per-tab audio mixer (desktop chrome only). Channels live in MIXER_IPC (shared/audio-mixer.ts). */
export interface VelaChromeAPI {
  mixer: {
    /** Settings + routing of every tab that has audio settings or is audible. */
    get(): Promise<MixerTabState[]>;
    onState(cb: (tabs: MixerTabState[]) => void): Unsubscribe;
    /** Merge `patch` into the tab's settings; applies live. */
    set(tabId: number, patch: Partial<TabAudioSettings>): Promise<MixerTabState>;
    reset(tabId: number): Promise<MixerTabState>;
    /** Start/stop streaming levels (call with true while the panel is open). */
    watchLevels(on: boolean): Promise<void>;
    onLevels(cb: (levels: TabAudioLevel[]) => void): Unsubscribe;
  };
}

/** MantelVPN (chrome only). Channels live in VPN_IPC (shared/vpn.ts); see docs/ARCHITECTURE.md → VPN. */
export interface VelaChromeAPI {
  vpn: {
    /** Current state as main knows it (no network). */
    state(): Promise<VpnState>;
    /** Re-signs in / reloads account + servers from Mantel. */
    refresh(): Promise<VpnState>;
    /** Account number (16 digits, spaces/dashes allowed). Stored with safeStorage in main only. */
    login(accountNumber: string): Promise<VpnResult>;
    /** Second step when Mantel asks for a two-factor code. */
    verifyTotp(code: string): Promise<VpnResult>;
    logout(): Promise<VpnState>;
    /** Routes the active Space through a Mantel proxy on that location (live mode only). */
    connect(serverId: string): Promise<VpnResult>;
    disconnect(): Promise<VpnState>;
    /** Routes one tab through a MantelVPN country (own partition), or back to its Space with null. */
    routeTab(tabId: number, country: string | null): Promise<VpnResult>;
    onState(cb: (state: VpnState) => void): Unsubscribe;
  };
}

/** Site info popover (chrome) and site-data-on-close policies (Settings → Privacy). Channels live in SITE_IPC (shared/site-data.ts). */
export interface VelaChromeAPI {
  site: {
    /** Connection, cookies, storage, permissions and close policy of a tab's site; null for non-web pages. */
    info(tabId: number): Promise<SiteInfo | null>;
    /** Deletes the site's cookies and storage in the tab's Space. */
    clear(tabId: number): Promise<SiteInfo | null>;
    /** Forgets a remembered permission answer so the site has to ask again. */
    resetPermission(tabId: number, key: SitePermissionKey): Promise<SiteInfo | null>;
    /** Per-site "keep" / "delete when Vela closes"; null falls back to the Space default. */
    setOnClose(tabId: number, action: SiteCloseAction | null): Promise<SiteInfo | null>;
  };
}

export interface SpaceSiteDataPolicy {
  spaceId: SpaceId;
  name: string;
  color: string;
  policy: SiteDataPolicy;
}

export interface VelaPagesAPI {
  siteData: {
    /** Close policies of every persistent Space (burner Spaces are always wiped). */
    list(): Promise<SpaceSiteDataPolicy[]>;
    set(spaceId: SpaceId, policy: SiteDataPolicy): Promise<SpaceSiteDataPolicy[]>;
  };
}

/** Task manager (chrome only). Channels live in TASK_MANAGER_IPC (shared/task-manager.ts). */
export interface VelaChromeAPI {
  taskManager: {
    /** Per-tab / extension / service CPU and memory; poll only while the panel is open. */
    snapshot(): Promise<TaskSnapshot>;
    /** Crash the tab's renderer (shows the crash page). */
    endProcess(tabId: number): Promise<void>;
  };
}

/** Password manager prompts (chrome only). Channels live in PASSWORD_IPC (shared/passwords.ts). No passwords cross this API. */
export interface VelaChromeAPI {
  passwords: {
    onSavePrompt(cb: (prompt: PasswordSavePrompt) => void): Unsubscribe;
    onSaveCancel(cb: (id: string) => void): Unsubscribe;
    answerSave(id: string, answer: PasswordSaveAnswer): Promise<void>;
    onFillOffer(cb: (offer: PasswordFillOffer) => void): Unsubscribe;
    onFillCancel(cb: (id: string) => void): Unsubscribe;
    /** Main re-checks the frame's origin, then fills that frame only. */
    fill(offerId: string, loginId: string): Promise<void>;
    dismissOffer(offerId: string): Promise<void>;
  };
  aliases: {
    onOffer(cb: (offer: AliasOffer) => void): Unsubscribe;
    onOfferCancel(cb: (id: string) => void): Unsubscribe;
    /** Main creates the alias at the provider and fills the focused field of that frame only. */
    create(offerId: string): Promise<{ email: string }>;
    dismiss(offerId: string): Promise<void>;
  };
}

/** Battery saver (chrome only). Channels live in BATTERY_IPC (shared/battery.ts). */
export interface VelaChromeAPI {
  battery: {
    state(): Promise<BatterySaverState>;
    /** Battery level 0–1 from navigator.getBattery (null when unknown); only needed for the "Below 20 %" mode. */
    report(level: number | null): Promise<void>;
    onChange(cb: (state: BatterySaverState) => void): Unsubscribe;
  };
}

/** vela://passwords only (main rejects every other page). */
export interface VelaPagesAPI {
  passwords?: {
    status(): Promise<PasswordsStatus>;
    list(spaceId: SpaceId): Promise<SavedLogin[]>;
    /** Plain password, after the page's explicit two-step reveal. */
    reveal(spaceId: SpaceId, loginId: string): Promise<string>;
    /** Copied by main; a copied password is cleared from the clipboard after 30 s. */
    copy(spaceId: SpaceId, loginId: string, field: 'username' | 'password'): Promise<void>;
    update(spaceId: SpaceId, loginId: string, patch: SavedLoginPatch): Promise<SavedLogin>;
    remove(spaceId: SpaceId, loginId: string): Promise<void>;
    /** Save dialog + file write happen in main. */
    exportCsv(spaceId: SpaceId): Promise<{ saved: boolean; count: number }>;
    removeNever(spaceId: SpaceId, origin: string): Promise<void>;
  };
  /** vela://settings only. The API key goes in, never comes back out. */
  aliases?: {
    get(): Promise<AliasSettingsView>;
    set(patch: AliasSettingsPatch): Promise<AliasSettingsView>;
    /** Validates the key with the provider, then stores it encrypted; null removes it. */
    setKey(key: string | null): Promise<AliasSettingsView>;
    options(): Promise<AliasOptions>;
  };
}
