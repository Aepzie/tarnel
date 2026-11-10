import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { ImportedBookmark } from '../../shared/bookmarks';
import type { BrowserKind, BrowserProfile } from '../../shared/import';
import { msToWebkitMs, parseChromiumBookmarks } from './chromium-parse';
import { assembleFirefoxBookmarks, parseProfilesIni, type FirefoxBookmarkRow } from './firefox-parse';
import { withDatabaseCopy } from './sqlite';

export interface ImportedVisit {
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
}

interface ProfileLocation extends BrowserProfile {
  dir: string;
}

interface ChromiumBrowser {
  kind: Exclude<BrowserKind, 'firefox'>;
  name: string;
  /** User-data folder per platform. */
  win?: string[];
  mac?: string[];
  linux?: string[];
  /** Opera keeps a single profile directly in its user-data folder. */
  flat?: boolean;
}

const CHROMIUM_BROWSERS: readonly ChromiumBrowser[] = [
  { kind: 'chrome', name: 'Google Chrome', win: ['LOCAL', 'Google', 'Chrome', 'User Data'], mac: ['Google', 'Chrome'], linux: ['google-chrome'] },
  { kind: 'edge', name: 'Microsoft Edge', win: ['LOCAL', 'Microsoft', 'Edge', 'User Data'], mac: ['Microsoft Edge'], linux: ['microsoft-edge'] },
  { kind: 'brave', name: 'Brave', win: ['LOCAL', 'BraveSoftware', 'Brave-Browser', 'User Data'], mac: ['BraveSoftware', 'Brave-Browser'], linux: ['BraveSoftware', 'Brave-Browser'] },
  { kind: 'vivaldi', name: 'Vivaldi', win: ['LOCAL', 'Vivaldi', 'User Data'], mac: ['Vivaldi'], linux: ['vivaldi'] },
  { kind: 'opera', name: 'Opera', win: ['ROAMING', 'Opera Software', 'Opera Stable'], mac: ['com.operasoftware.Opera'], linux: ['opera'], flat: true },
  { kind: 'chromium', name: 'Chromium', win: ['LOCAL', 'Chromium', 'User Data'], mac: ['Chromium'], linux: ['chromium'] },
];

function localAppData(): string {
  return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
}

function roamingAppData(): string {
  return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
}

function chromiumUserData(browser: ChromiumBrowser): string | null {
  if (process.platform === 'win32') {
    if (!browser.win) return null;
    const [base, ...rest] = browser.win;
    return join(base === 'ROAMING' ? roamingAppData() : localAppData(), ...rest);
  }
  if (process.platform === 'darwin') return browser.mac ? join(homedir(), 'Library', 'Application Support', ...browser.mac) : null;
  return browser.linux ? join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), ...browser.linux) : null;
}

function firefoxRoots(): string[] {
  if (process.platform === 'win32') return [join(roamingAppData(), 'Mozilla', 'Firefox')];
  if (process.platform === 'darwin') return [join(homedir(), 'Library', 'Application Support', 'Firefox')];
  return [
    join(homedir(), '.mozilla', 'firefox'),
    join(homedir(), 'snap', 'firefox', 'common', '.mozilla', 'firefox'),
    join(homedir(), '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'),
  ];
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

function chromiumProfileNames(userData: string): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const state = JSON.parse(readFileSync(join(userData, 'Local State'), 'utf8')) as { profile?: { info_cache?: Record<string, { name?: unknown }> } };
    for (const [dir, entry] of Object.entries(state.profile?.info_cache ?? {})) {
      if (typeof entry?.name === 'string' && entry.name) names.set(dir, entry.name);
    }
  } catch {
    /* no Local State: fall back to folder names */
  }
  return names;
}

function chromiumProfiles(browser: ChromiumBrowser): ProfileLocation[] {
  const userData = chromiumUserData(browser);
  if (!userData || !existsSync(userData)) return [];
  const location = (dir: string, profileName: string, key: string): ProfileLocation | null => {
    const hasBookmarks = isFile(join(dir, 'Bookmarks'));
    const hasHistory = isFile(join(dir, 'History'));
    if (!hasBookmarks && !hasHistory) return null;
    return { id: `${browser.kind}:${key}`, browser: browser.kind, browserName: browser.name, profileName, hasBookmarks, hasHistory, dir };
  };
  if (browser.flat) {
    const flat = location(userData, 'Default', 'Default');
    return flat ? [flat] : [];
  }
  const names = chromiumProfileNames(userData);
  let entries: string[] = [];
  try {
    entries = readdirSync(userData);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry === 'Default' || /^Profile \d+$/.test(entry))
    .sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b, undefined, { numeric: true })))
    .map((entry) => location(join(userData, entry), names.get(entry) ?? entry, entry))
    .filter((profile): profile is ProfileLocation => profile !== null);
}

function firefoxProfiles(): ProfileLocation[] {
  const out: ProfileLocation[] = [];
  for (const root of firefoxRoots()) {
    let ini: string;
    try {
      ini = readFileSync(join(root, 'profiles.ini'), 'utf8');
    } catch {
      continue;
    }
    const entries = parseProfilesIni(ini).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    for (const entry of entries) {
      const dir = entry.relative || !isAbsolute(entry.path) ? join(root, entry.path) : entry.path;
      if (!isFile(join(dir, 'places.sqlite'))) continue;
      if (out.some((profile) => profile.dir === dir)) continue;
      out.push({
        id: `firefox:${out.length}:${entry.path}`,
        browser: 'firefox',
        browserName: 'Firefox',
        profileName: entry.name,
        hasBookmarks: true,
        hasHistory: true,
        dir,
      });
    }
  }
  return out;
}

function detect(): ProfileLocation[] {
  return [...CHROMIUM_BROWSERS.flatMap(chromiumProfiles), ...firefoxProfiles()];
}

export function listProfiles(): BrowserProfile[] {
  return detect().map(({ dir: _dir, ...profile }) => profile);
}

function findProfile(id: string): ProfileLocation {
  const profile = detect().find((candidate) => candidate.id === id);
  if (!profile) throw new Error('That browser profile is no longer available.');
  return profile;
}

export function profileLabel(id: string): string {
  const profile = findProfile(id);
  return detect().filter((p) => p.browser === profile.browser).length > 1 ? `${profile.browserName} (${profile.profileName})` : profile.browserName;
}

const MAX_BOOKMARKS_FILE = 64 * 1024 * 1024;

export async function readBookmarks(id: string): Promise<ImportedBookmark[]> {
  const profile = findProfile(id);
  if (profile.browser !== 'firefox') {
    const file = join(profile.dir, 'Bookmarks');
    if (statSync(file).size > MAX_BOOKMARKS_FILE) throw new Error('The bookmarks file is too large.');
    return parseChromiumBookmarks(await readFile(file, 'utf8'));
  }
  return withDatabaseCopy(join(profile.dir, 'places.sqlite'), (db) => {
    const rows = db
      .prepare(
        `SELECT b.id AS id, b.parent AS parent, b.type AS type, b.position AS position, b.title AS title,
                b.dateAdded AS dateAdded, b.guid AS guid, p.url AS url
           FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk`,
      )
      .all() as unknown as FirefoxBookmarkRow[];
    return assembleFirefoxBookmarks(rows);
  });
}

function visitRows(rows: readonly Record<string, unknown>[]): ImportedVisit[] {
  const out: ImportedVisit[] = [];
  for (const row of rows) {
    const { url, title, visits, lastVisit } = row;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 8192) continue;
    if (typeof lastVisit !== 'number' || !Number.isFinite(lastVisit) || lastVisit <= 0) continue;
    out.push({
      url,
      title: typeof title === 'string' ? title : '',
      visits: typeof visits === 'number' && visits > 0 ? visits : 1,
      lastVisit: Math.round(lastVisit),
    });
  }
  return out;
}

/** Most visited pages first, last visit within `days`, at most `limit` rows. */
export async function readHistory(id: string, days: number, limit: number): Promise<ImportedVisit[]> {
  const profile = findProfile(id);
  const since = Date.now() - days * 86_400_000;
  if (profile.browser !== 'firefox') {
    // last_visit_time is µs since 1601 (beyond 2^53), so it is scaled to ms inside SQLite.
    return withDatabaseCopy(join(profile.dir, 'History'), (db) =>
      visitRows(
        db
          .prepare(
            `SELECT url, title, visit_count AS visits, (last_visit_time / 1000) - ? AS lastVisit
               FROM urls
              WHERE hidden = 0 AND last_visit_time / 1000 >= ?
              ORDER BY visit_count DESC, last_visit_time DESC
              LIMIT ?`,
          )
          .all(msToWebkitMs(0), msToWebkitMs(since), limit) as Record<string, unknown>[],
      ),
    );
  }
  return withDatabaseCopy(join(profile.dir, 'places.sqlite'), (db) =>
    visitRows(
      db
        .prepare(
          `SELECT url, title, visit_count AS visits, last_visit_date / 1000 AS lastVisit
             FROM moz_places
            WHERE hidden = 0 AND visit_count > 0 AND last_visit_date >= ?
            ORDER BY visit_count DESC, last_visit_date DESC
            LIMIT ?`,
        )
        .all(since * 1000, limit) as Record<string, unknown>[],
    ),
  );
}
