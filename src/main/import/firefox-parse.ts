import type { ImportedBookmark } from '../../shared/bookmarks';
import { importableUrl } from './chromium-parse';

/** One row of `moz_bookmarks LEFT JOIN moz_places`. */
export interface FirefoxBookmarkRow {
  id: number;
  parent: number | null;
  /** 1 bookmark, 2 folder, 3 separator. */
  type: number;
  position: number;
  title: string | null;
  /** Microseconds since the Unix epoch. */
  dateAdded: number | null;
  guid: string | null;
  url: string | null;
}

const ROOT_TITLES: readonly { guid: string; title: string }[] = [
  { guid: 'toolbar_____', title: 'Bookmarks toolbar' },
  { guid: 'menu________', title: 'Bookmarks menu' },
  { guid: 'unfiled_____', title: 'Other bookmarks' },
  { guid: 'mobile______', title: 'Mobile bookmarks' },
];

const MAX_DEPTH = 64;

/** Builds the bookmark tree from places.sqlite rows; tags and smart (place:) bookmarks are left out. */
export function assembleFirefoxBookmarks(rows: readonly FirefoxBookmarkRow[]): ImportedBookmark[] {
  const byParent = new Map<number, FirefoxBookmarkRow[]>();
  for (const row of rows) {
    if (row.parent === null) continue;
    const siblings = byParent.get(row.parent);
    if (siblings) siblings.push(row);
    else byParent.set(row.parent, [row]);
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.position - b.position);

  const visited = new Set<number>();
  const build = (row: FirefoxBookmarkRow, depth: number): ImportedBookmark | null => {
    if (visited.has(row.id)) return null;
    visited.add(row.id);
    const title = row.title ?? '';
    const addedAt = row.dateAdded && row.dateAdded > 0 ? Math.round(row.dateAdded / 1000) : undefined;
    const stamp = addedAt ? { addedAt } : {};
    if (row.type === 1) return importableUrl(row.url) ? { title, url: row.url, ...stamp } : null;
    if (row.type !== 2 || depth > MAX_DEPTH) return null;
    const children = (byParent.get(row.id) ?? [])
      .map((child) => build(child, depth + 1))
      .filter((child): child is ImportedBookmark => child !== null);
    return { title, children, ...stamp };
  };

  const out: ImportedBookmark[] = [];
  for (const { guid, title } of ROOT_TITLES) {
    const root = rows.find((row) => row.guid === guid);
    if (!root) continue;
    const folder = build(root, 0);
    if (!folder?.children?.length) continue;
    out.push({ ...folder, title });
  }
  return out;
}

export interface FirefoxProfileEntry {
  name: string;
  /** Absolute, or relative to the profiles.ini folder when `relative`. */
  path: string;
  relative: boolean;
  isDefault: boolean;
}

/** Parses Firefox's profiles.ini (Profile* sections; Install* Default= marks the profile in use). */
export function parseProfilesIni(text: string): FirefoxProfileEntry[] {
  const sections: { name: string; values: Map<string, string> }[] = [];
  let current: { name: string; values: Map<string, string> } | null = null;
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = { name: header[1]!, values: new Map() };
      sections.push(current);
      continue;
    }
    const eq = line.indexOf('=');
    if (!current || eq < 1) continue;
    current.values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  const installDefaults = new Set(
    sections.filter((s) => s.name.startsWith('Install')).map((s) => s.values.get('Default')).filter((v): v is string => !!v),
  );
  return sections
    .filter((s) => /^Profile\d+$/.test(s.name) && s.values.get('Path'))
    .map((s) => {
      const path = s.values.get('Path')!;
      return {
        name: s.values.get('Name') || path,
        path,
        relative: s.values.get('IsRelative') !== '0',
        isDefault: installDefaults.has(path) || s.values.get('Default') === '1',
      };
    });
}
