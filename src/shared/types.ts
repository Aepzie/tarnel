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
  /** Tab group this tab belongs to (never set on pinned tabs). Group members are contiguous. */
  groupId: TabGroupId | null;
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

export interface BrowserState {
  tabs: TabState[];
  activeTabId: number | null;
  spaces: Space[];
  activeSpaceId: SpaceId;
  /** Groups of all spaces in display order (by their first tab); only non-empty groups are listed. */
  groups: TabGroup[];
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
  tabLayout: 'horizontal',
};
