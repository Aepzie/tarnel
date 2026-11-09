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
  createdAt: number;
}

export interface SpaceInput {
  name: string;
  color: SpaceColor;
  ephemeral: boolean;
  proxy?: string;
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
}

export interface BrowserState {
  tabs: TabState[];
  activeTabId: number | null;
  spaces: Space[];
  activeSpaceId: SpaceId;
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
  /** @deprecated kept for settings-file compatibility; the chrome is a top island now. */
  sidebarCollapsed: boolean;
  /** @deprecated kept for settings-file compatibility. */
  sidebarWidth: number;
  /** Focus mode: the top island hides and reveals on hover at the top edge. */
  autoHideToolbar: boolean;
  windowMaterial: WindowMaterial;
  /** Start-page hero style; shared across all tabs and spaces. */
  newtabHero: NewtabHero;
}

export interface Suggestion {
  kind: 'url' | 'history' | 'search' | 'tab';
  title: string;
  url: string;
  /** Present when kind === 'tab': switching to an existing tab. */
  tabId?: number;
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
