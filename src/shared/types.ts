export type SpaceId = string;

export type SpaceColor =
  | 'slate'
  | 'blue'
  | 'violet'
  | 'pink'
  | 'red'
  | 'orange'
  | 'green'
  | 'teal';

export interface Space {
  id: SpaceId;
  name: string;
  color: SpaceColor;
  /** In-memory partition. Wiped completely when the space is removed or the app quits. */
  ephemeral: boolean;
  /** Optional proxy rules for this space only, e.g. "socks5://127.0.0.1:9050". Empty = direct. */
  proxy: string;
  /** Per-space fingerprint protection. Burner spaces default to 'strict'. */
  fingerprint: FingerprintLevel;
  /** Timezone pages see (protected Spaces only); see TIMEZONE_* in shared/fingerprint. Missing = automatic. */
  timezone?: string;
  /** Language pages see (protected Spaces only); '' or missing = system. */
  language?: string;
  createdAt: number;
}

export const FINGERPRINT_LEVELS = ['off', 'standard', 'strict'] as const;
export type FingerprintLevel = (typeof FINGERPRINT_LEVELS)[number];

export interface SpaceInput {
  name: string;
  color: SpaceColor;
  ephemeral: boolean;
  proxy?: string;
  fingerprint?: FingerprintLevel;
  timezone?: string;
  language?: string;
}

export interface TabState {
  id: number;
  spaceId: SpaceId;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Webcontents destroyed to free memory; recreated on activation. */
  asleep: boolean;
  audible: boolean;
  muted: boolean;
  pinned: boolean;
  /** Requests blocked by the content blocker in this tab since last navigation. */
  blockedCount: number;
  /** Zoom factor, 1 = 100%. */
  zoom: number;
  secure: boolean;
  /** Tab group this tab belongs to (never set on pinned tabs). Group members are contiguous. */
  groupId: TabGroupId | null;
  /** Split view this tab is a pane of. Split members are adjacent and share their group. */
  splitId: SplitId | null;
  /** Devices picked for this tab; null = all on "System default". */
  devices: TabMediaDevices | null;
  /** The current page was granted the microphone (cleared when the tab navigates away). */
  micActive: boolean;
  /** MantelVPN country this tab routes through (lower-case ISO code, own partition); null = the Space's network. */
  vpn: string | null;
}

/** Speakers/headphones, microphone, camera. */
export const MEDIA_DEVICE_SLOTS = ['output', 'input', 'camera'] as const;
export type MediaDeviceSlot = (typeof MEDIA_DEVICE_SLOTS)[number];

/**
 * A device picked for a tab. Device ids are salted per origin, so it is matched by label in every
 * frame; `ordinal` tells identical labels apart, `index` (among all devices of the kind) is used when
 * labels are hidden (strict fingerprint protection reports generic ones).
 */
export interface MediaDeviceChoice {
  label: string;
  ordinal: number;
  index: number;
}

export type TabMediaDevices = Partial<Record<MediaDeviceSlot, MediaDeviceChoice>>;

export type SplitId = string;

/** 2–4 tabs of one Space shown side by side (2 = columns, 3 = left + stacked right, 4 = 2×2). */
export interface TabSplit {
  id: SplitId;
  spaceId: SpaceId;
  /** Pane order: left to right, then top to bottom. */
  tabIds: number[];
  /** Share of the width taken by the left column (0..1). */
  ratioX: number;
  /** Share of the height taken by the top row (3–4 panes). */
  ratioY: number;
}

export type TabGroupId = string;

/** A named, colored, collapsible run of tabs inside one Space. */
export interface TabGroup {
  id: TabGroupId;
  spaceId: SpaceId;
  /** May be empty: the group then shows as a bare color dot. */
  name: string;
  color: SpaceColor;
  /** Collapsed groups hide their tabs, except the active one. */
  collapsed: boolean;
}

export type TabGroupInput = Pick<TabGroup, 'name' | 'color' | 'collapsed'>;

/** Where the tab list lives: the top island strip, or a floating island on the left. */
export type TabLayout = 'horizontal' | 'vertical';

/**
 * Which refresh rate Chromium paces frames to on Windows (see docs/PERFORMANCE.md → Frame rate).
 * 'match' = the display the window opens on, 'highest' = the fastest connected display,
 * 'primary' = the primary display (stock Chromium). Applied at launch.
 */
export type FrameRateMode = 'match' | 'highest' | 'primary';

export const FRAME_RATE_MODES: readonly FrameRateMode[] = ['match', 'highest', 'primary'];

export interface DisplayRefresh {
  id: number;
  label: string;
  /** Refresh rate in whole Hz (Electron's `displayFrequency`, rounded). */
  hz: number;
  primary: boolean;
  /** The window is (mostly) on this display. */
  current: boolean;
}

export interface FrameRateStatus {
  /** The setting does something on this platform (Windows). Elsewhere Chromium follows each display itself. */
  supported: boolean;
  displays: DisplayRefresh[];
  /** Rate Chromium paces frames to with the switches this run started with. */
  pacedHz: number | null;
  /** The setting or the window's display changed since launch in a way that needs a restart. */
  restartRequired: boolean;
}

export interface BrowserState {
  tabs: TabState[];
  activeTabId: number | null;
  spaces: Space[];
  activeSpaceId: SpaceId;
  /** Groups of all spaces in display order (by their first tab); only non-empty groups are listed. */
  groups: TabGroup[];
  /** Split views of all spaces. The one holding `activeTabId` is on screen. */
  splits: TabSplit[];
}

export type SearchEngine = 'duckduckgo' | 'google' | 'brave' | 'startpage' | 'ecosia';
export type ThemeMode = 'system' | 'dark' | 'light';
/** Windows 11 backdrop behind the floating islands. Ignored on other platforms. */
export type WindowMaterial = 'mica' | 'acrylic' | 'none';
/** Hero shown above the search bar on the new-tab page, in cycle order. */
export const NEWTAB_HEROES = ['clock', 'clock-seconds', 'logo', 'date', 'greeting', 'minimal'] as const;
export type NewtabHero = (typeof NEWTAB_HEROES)[number];

export interface Settings {
  searchEngine: SearchEngine;
  theme: ThemeMode;
  adblock: boolean;
  /** Minutes of inactivity before a background tab is put to sleep. 0 = never. */
  sleepAfterMinutes: number;
  httpsOnly: boolean;
  blockThirdPartyCookies: boolean;
  sendDoNotTrack: boolean;
  restoreSession: boolean;
  /** Vertical tab layout: the tab island is collapsed to icons only. */
  sidebarCollapsed: boolean;
  /** Vertical tab layout: width of the tab island in CSS px. */
  sidebarWidth: number;
  /** Focus mode: the top island hides and reveals on hover at the top edge. */
  autoHideToolbar: boolean;
  windowMaterial: WindowMaterial;
  /** Start-page hero style; shared across all tabs and spaces. */
  newtabHero: NewtabHero;
  tabLayout: TabLayout;
  /** Frame pacing on Windows; takes effect at the next launch. */
  frameRate: FrameRateMode;
  /** Check GitHub releases on startup and every 6 h. */
  updateAutoCheck: boolean;
  /** Download updates in the background (installable builds only). */
  updateAutoDownload: boolean;
  /** Offer pre-releases (e.g. 0.3.0-beta.1). */
  updatePrerelease: boolean;
}

export interface Suggestion {
  kind: 'url' | 'history' | 'search' | 'tab' | 'remote-tab';
  title: string;
  url: string;
  /** Present when kind === 'tab': switching to an existing tab. */
  tabId?: number;
  /** Present when kind === 'remote-tab': name of the device the tab is open on. */
  device?: string;
}

export interface TopSite {
  url: string;
  title: string;
  visits: number;
  /** Cached favicon as a data: URL (never a remote URL — avoids pinging sites on every new tab). */
  favicon?: string;
}

export type PermissionKind = 'media' | 'geolocation' | 'notifications';

/** A pending site permission request, answered in the browser chrome (never a native dialog). */
export interface PermissionRequest {
  id: string;
  tabId: number | null;
  origin: string;
  host: string;
  permission: PermissionKind;
  /** For 'media': which devices are requested. */
  mediaTypes?: ('video' | 'audio')[];
}

export interface HistoryEntry {
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
  /** Cached data: URL favicon if known. */
  favicon?: string;
}

export interface PerfStats {
  totalMemoryMB: number;
  cpuPercent: number;
  tabsAwake: number;
  tabsAsleep: number;
  blockedTotal: number;
  /** Estimated memory saved by sleeping tabs (MB). */
  savedMemoryMB: number;
}

export interface FindResult {
  tabId: number;
  activeMatchOrdinal: number;
  matches: number;
}

export interface DownloadState {
  id: string;
  filename: string;
  path: string;
  receivedBytes: number;
  totalBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
}

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type UICommand =
  | 'focus-address'
  | 'command-palette'
  | 'find'
  | 'toggle-sidebar'
  | 'new-space'
  | 'audio-mixer'
  | 'escape';

export const SPACE_COLORS: readonly SpaceColor[] = [
  'slate',
  'blue',
  'violet',
  'pink',
  'red',
  'orange',
  'green',
  'teal',
];

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'duckduckgo',
  theme: 'system',
  adblock: true,
  sleepAfterMinutes: 10,
  httpsOnly: true,
  blockThirdPartyCookies: true,
  sendDoNotTrack: true,
  restoreSession: true,
  sidebarCollapsed: false,
  sidebarWidth: 240,
  autoHideToolbar: false,
  windowMaterial: 'mica',
  newtabHero: 'clock',
  tabLayout: 'horizontal',
  frameRate: 'match',
  updateAutoCheck: true,
  updateAutoDownload: true,
  updatePrerelease: false,
};

/** Where an installed extension came from. */
export type ExtensionSource = 'store' | 'unpacked';

/** 'all' = every non-burner Space, including ones created later; otherwise exactly these Spaces. */
export type ExtensionSpaces = 'all' | SpaceId[];

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  source: ExtensionSource;
  enabled: boolean;
  spaces: ExtensionSpaces;
  /** Action button shown directly in the top island (otherwise only in the extensions menu). */
  pinned: boolean;
  /** Manifest icon as a data: URL. */
  icon: string | null;
  hasOptions: boolean;
  /** Last load failure (e.g. unpacked folder moved); cleared on the next successful load. */
  error: string | null;
}

export interface ExtensionPatch {
  enabled?: boolean;
  spaces?: ExtensionSpaces;
  pinned?: boolean;
}

/** Toolbar action state of one extension for the active tab. */
export interface ExtensionAction {
  id: string;
  title: string;
  badgeText: string;
  badgeColor: string | null;
  /** Current action icon (may differ per tab) as a data: URL. */
  icon: string | null;
}

export interface ExtensionsState {
  extensions: ExtensionInfo[];
  /** Actions of the extensions running in the active tab's Space. */
  actions: ExtensionAction[];
}

/** Rect (CSS px, window-relative) of the button an extension popup hangs from. */
export interface ExtensionAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What end-to-end encrypted sync carries. History is off by default. */
export interface SyncCategories {
  settings: boolean;
  spaces: boolean;
  tabs: boolean;
  history: boolean;
}

export const DEFAULT_SYNC_CATEGORIES: SyncCategories = { settings: true, spaces: true, tabs: true, history: false };

/** User-owned sync storage. Vela never runs a sync server. */
export type SyncTransportInput =
  | { kind: 'folder'; path: string }
  | { kind: 'webdav'; url: string; username: string; password: string };

export interface SyncSetupInput {
  transport: SyncTransportInput;
  /** 'create' = first device (new key), 'join' = existing sync data at that location. */
  mode: 'create' | 'join';
  /** Passphrase, or the recovery key when joining. */
  secret: string;
  categories: SyncCategories;
}

export interface SyncDevice {
  id: string;
  name: string;
  /** Last time this device published its changes. */
  lastSeen: number;
  current: boolean;
}

export interface SyncStatus {
  enabled: boolean;
  /** OS secret storage (DPAPI / Keychain / libsecret) is usable; sync requires it. */
  secureStorage: boolean;
  transport: { kind: 'folder' | 'webdav'; label: string } | null;
  categories: SyncCategories;
  syncing: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  devices: SyncDevice[];
}

/**
 * How this build can update itself. `install` = electron-updater downloads and installs (NSIS,
 * AppImage, signed macOS); `notify` = only tells the user and links the release page.
 */
export type UpdateMode = 'install' | 'notify' | 'disabled';
export type UpdateNotifyReason = 'portable' | 'mac-unsigned' | 'linux-package' | 'dev';

export type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';

export interface UpdateStatus {
  mode: UpdateMode;
  reason?: UpdateNotifyReason;
  phase: UpdatePhase;
  currentVersion: string;
  /** Newer version found (available / downloading / ready). */
  version?: string;
  releaseName?: string;
  /** HTML (GitHub feed) or markdown/plain text (generic feed). Rendered as sanitized text. */
  releaseNotes?: string;
  releaseDate?: string;
  releaseUrl?: string;
  /** 0..100 while downloading. */
  percent?: number;
  bytesPerSecond?: number;
  /** The download was started by the user (not in the background). */
  manual?: boolean;
  error?: string;
  /** Epoch ms of the last finished check. */
  checkedAt?: number;
}
