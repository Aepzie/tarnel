import type { ExtensionPermission, PermissionRisk } from '../../shared/types';

/**
 * Plain-language permission review for extensions (pure: no electron, unit-tested). Reads the
 * manifest's permissions, optional_permissions, host_permissions and content_scripts matches.
 */

export interface PermissionManifest {
  permissions?: unknown;
  optional_permissions?: unknown;
  host_permissions?: unknown;
  optional_host_permissions?: unknown;
  content_scripts?: unknown;
}

const RISK_ORDER: Record<PermissionRisk, number> = { low: 0, medium: 1, high: 2 };

/** API permissions Tarnel shows; anything not listed (and not silent) is shown as low. */
const KNOWN: Record<string, { label: string; risk: PermissionRisk }> = {
  debugger: { label: 'Access the page debugger (full control of pages)', risk: 'high' },
  nativeMessaging: { label: 'Talk to programs installed on your computer', risk: 'high' },
  proxy: { label: 'Change how your traffic is routed (proxy settings)', risk: 'high' },
  history: { label: 'Read and change your browsing history', risk: 'high' },
  management: { label: 'Manage your other extensions', risk: 'high' },
  privacy: { label: 'Change privacy-related settings', risk: 'high' },
  webRequestBlocking: { label: 'Block and modify network requests', risk: 'high' },
  cookies: { label: 'Read and change cookies on sites it can access', risk: 'medium' },
  webRequest: { label: 'Observe network requests on sites it can access', risk: 'medium' },
  tabs: { label: 'See the address and title of your tabs', risk: 'medium' },
  webNavigation: { label: 'See the address and title of your tabs', risk: 'medium' },
  downloads: { label: 'Manage your downloads', risk: 'medium' },
  bookmarks: { label: 'Read and change your bookmarks', risk: 'medium' },
  clipboardRead: { label: 'Read what you copy and paste', risk: 'medium' },
  geolocation: { label: 'Detect your physical location', risk: 'medium' },
  pageCapture: { label: 'Save pages you visit', risk: 'medium' },
  tabCapture: { label: 'Capture the content of your tabs', risk: 'medium' },
  desktopCapture: { label: 'Capture your screen', risk: 'medium' },
  identity: { label: 'Know your signed-in identity', risk: 'medium' },
  declarativeNetRequest: { label: 'Block content on pages you visit', risk: 'low' },
  declarativeNetRequestWithHostAccess: { label: 'Block or redirect requests on sites it can access', risk: 'low' },
  scripting: { label: 'Run scripts on sites it can access', risk: 'low' },
  activeTab: { label: 'Access the current site when you click it', risk: 'low' },
  clipboardWrite: { label: 'Change what you copy and paste', risk: 'low' },
  notifications: { label: 'Show notifications', risk: 'low' },
  topSites: { label: 'See your most visited sites', risk: 'low' },
};

/** Permissions Chrome itself never warns about. */
const SILENT = new Set([
  'storage',
  'unlimitedStorage',
  'alarms',
  'contextMenus',
  'idle',
  'offscreen',
  'sidePanel',
  'action',
  'commands',
  'i18n',
  'runtime',
  'power',
  'fontSettings',
  'declarativeNetRequestFeedback',
  'background',
  'favicon',
]);

const ALL_HOSTS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*', '*://*/', 'http://*/', 'https://*/', 'file:///*']);
const MAX_LISTED_HOSTS = 3;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
}

export function isHostPattern(value: string): boolean {
  return value === '<all_urls>' || /^(\*|https?|wss?|file|ftp):\/\//.test(value);
}

export function coversAllSites(pattern: string): boolean {
  if (ALL_HOSTS.has(pattern)) return true;
  const match = /^(?:\*|https?|wss?):\/\/([^/]*)\//.exec(pattern);
  return match?.[1] === '*';
}

/** "*://*.example.com/*" → "example.com". */
export function hostLabel(pattern: string): string {
  const match = /^[^:]+:\/\/([^/]*)/.exec(pattern);
  const host = match?.[1] ?? pattern;
  return host.replace(/^\*\./, '').replace(/:\*$/, '') || pattern;
}

/** Every host pattern the extension asks for (required permissions + content script matches). */
export function requestedHosts(manifest: PermissionManifest): string[] {
  const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const fromScripts = scripts.flatMap((script) => strings((script as { matches?: unknown } | null)?.matches));
  const fromPermissions = strings(manifest.permissions).filter(isHostPattern);
  return [...new Set([...fromPermissions, ...strings(manifest.host_permissions), ...fromScripts])];
}

function hostEntry(hosts: string[]): ExtensionPermission | null {
  if (hosts.length === 0) return null;
  if (hosts.some(coversAllSites)) {
    return { id: 'hosts:all', label: 'Read and change all your data on all websites', risk: 'high' };
  }
  const names = [...new Set(hosts.map(hostLabel))].sort();
  const listed = names.slice(0, MAX_LISTED_HOSTS).join(', ');
  const rest = names.length - MAX_LISTED_HOSTS;
  const suffix = rest > 0 ? ` and ${rest} more` : '';
  return { id: 'hosts:some', label: `Read and change your data on ${listed}${suffix}`, risk: 'medium' };
}

function apiEntry(name: string): ExtensionPermission | null {
  if (SILENT.has(name)) return null;
  const known = KNOWN[name];
  if (known) return { id: name, ...known };
  return { id: name, label: `Use the “${name}” API`, risk: 'low' };
}

/** Plain-language list, highest risk first, deduplicated by label. */
export function classifyPermissions(manifest: PermissionManifest): ExtensionPermission[] {
  const apis = strings(manifest.permissions).filter((name) => !isHostPattern(name));
  const entries = [hostEntry(requestedHosts(manifest)), ...apis.map(apiEntry)].filter(
    (entry): entry is ExtensionPermission => entry !== null,
  );
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      if (seen.has(entry.label)) return false;
      seen.add(entry.label);
      return true;
    })
    .sort((a, b) => RISK_ORDER[b.risk] - RISK_ORDER[a.risk]);
}

export function overallRisk(permissions: readonly ExtensionPermission[]): PermissionRisk {
  return permissions.reduce<PermissionRisk>((max, entry) => (RISK_ORDER[entry.risk] > RISK_ORDER[max] ? entry.risk : max), 'low');
}
