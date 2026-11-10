/**
 * Curated extensions shown on vela://extensions. Every ID was checked against
 * chromewebstore.google.com/detail/<id> (the listing resolved to the named extension); MV2-only
 * listings that the store no longer serves (ClearURLs, JSON Viewer) were left out on purpose.
 * Installs still download from the store and go through the normal permission review.
 */

export type CatalogCategory = 'privacy' | 'passwords' | 'productivity' | 'developer';

export interface CatalogEntry {
  /** Chrome Web Store extension ID. */
  id: string;
  name: string;
  description: string;
  category: CatalogCategory;
  /** One line on what it asks for, so the review screen holds no surprises. */
  permissions: string;
}

export const CATALOG_CATEGORIES: { id: CatalogCategory; label: string }[] = [
  { id: 'privacy', label: 'Privacy & blocking' },
  { id: 'passwords', label: 'Passwords' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'developer', label: 'Developer' },
];

export const EXTENSION_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'ddkjiahejlhfcafbddmgiahcphecmpfh',
    name: 'uBlock Origin Lite',
    description: 'Content blocker built on declarative rules. Light on memory, no page access by default.',
    category: 'privacy',
    permissions: 'Blocking rules; page access only where you grant it.',
  },
  {
    id: 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp',
    name: 'Privacy Badger',
    description: 'Learns which third parties track you across sites and blocks them. By the EFF.',
    category: 'privacy',
    permissions: 'Reads and changes data on all sites.',
  },
  {
    id: 'mdjildafknihdffpkfmmpnpoiajfjnjd',
    name: 'Consent-O-Matic',
    description: 'Answers cookie consent pop-ups for you with the choices you set once.',
    category: 'privacy',
    permissions: 'Reads and changes data on all sites.',
  },
  {
    id: 'mlomiejdfkolichcflejclcbmpeaniij',
    name: 'Ghostery',
    description: 'Ad and tracker blocker with a per-site breakdown of who is watching.',
    category: 'privacy',
    permissions: 'Blocking rules; reads and changes data on all sites.',
  },
  {
    id: 'bkdgflcldnnnapblkhphbgpggdiikppg',
    name: 'DuckDuckGo Privacy Essentials',
    description: 'Tracker blocking, link cleaning and a privacy grade for each site.',
    category: 'privacy',
    permissions: 'Blocking rules; reads and changes data on all sites.',
  },
  {
    id: 'nngceckbapebfimnlniiiahkandclblb',
    name: 'Bitwarden',
    description: 'Open-source password manager with end-to-end encrypted sync.',
    category: 'passwords',
    permissions: 'Reads and changes data on all sites to fill logins.',
  },
  {
    id: 'ghmbeldphafepmbegfdlkpapadhbakde',
    name: 'Proton Pass',
    description: 'End-to-end encrypted passwords, passkeys and email aliases from Proton.',
    category: 'passwords',
    permissions: 'Reads and changes data on all sites to fill logins.',
  },
  {
    id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa',
    name: '1Password',
    description: 'Fill passwords, passkeys and cards from your 1Password vault.',
    category: 'passwords',
    permissions: 'Reads and changes data on all sites to fill logins.',
  },
  {
    id: 'oboonakemofpalcgghocfoadofidjkkk',
    name: 'KeePassXC-Browser',
    description: 'Connects to the KeePassXC desktop app. Your vault stays a local file.',
    category: 'passwords',
    permissions: 'Native messaging to KeePassXC; reads data on all sites.',
  },
  {
    id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh',
    name: 'Dark Reader',
    description: 'Dark theme for every site, with per-site brightness and contrast.',
    category: 'productivity',
    permissions: 'Reads and changes data on all sites.',
  },
  {
    id: 'mnjggcdmjocbbbhaepdhchncahnbgone',
    name: 'SponsorBlock',
    description: 'Skips sponsor segments and intros in YouTube videos, crowd-sourced.',
    category: 'productivity',
    permissions: 'Reads and changes data on YouTube.',
  },
  {
    id: 'gebbhagfogifgggkldgodflihgfeippi',
    name: 'Return YouTube Dislike',
    description: 'Shows estimated dislike counts on YouTube again.',
    category: 'productivity',
    permissions: 'Reads and changes data on YouTube.',
  },
  {
    id: 'dbepggeogbaibhgnhhndojpepiihcmeb',
    name: 'Vimium',
    description: 'Keyboard-first browsing: follow links, scroll and switch tabs with Vim keys.',
    category: 'productivity',
    permissions: 'Reads and changes data on all sites; manages tabs.',
  },
  {
    id: 'fmkadmapgofadopljbjfkapdkoienihi',
    name: 'React Developer Tools',
    description: 'Inspect React component trees, props, state and profiler traces.',
    category: 'developer',
    permissions: 'Reads data on all sites when DevTools is open.',
  },
  {
    id: 'nhdogjmejiglipccpnnnanhbledajbpd',
    name: 'Vue.js devtools',
    description: 'Inspect Vue components, Pinia stores and router state.',
    category: 'developer',
    permissions: 'Reads data on all sites when DevTools is open.',
  },
  {
    id: 'lmhkpmbekcpmknklioeibfkpmmfibljd',
    name: 'Redux DevTools',
    description: 'Time-travel debugging for Redux and similar state containers.',
    category: 'developer',
    permissions: 'Reads data on all sites when DevTools is open.',
  },
  {
    id: 'bcjindcccaagfpapjjmafapmmgkkhgoa',
    name: 'JSON Formatter',
    description: 'Pretty-prints raw JSON responses with folding and a raw toggle.',
    category: 'developer',
    permissions: 'Reads data on all sites (only acts on JSON pages).',
  },
];

const DETAIL_PATH = /^\/detail\/(?:[^/]+\/)?([a-p]{32})(?:[/?#]|$)/;

/** Extension ID from a Chrome Web Store detail page URL, or null. */
export function storeDetailId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'chromewebstore.google.com') return null;
  return DETAIL_PATH.exec(parsed.pathname)?.[1] ?? null;
}

export function storeSearchUrl(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `https://chromewebstore.google.com/search/${encodeURIComponent(trimmed)}` : 'https://chromewebstore.google.com/';
}

/** Case-insensitive match on name, description and category label. */
export function filterCatalog(entries: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  const labels = new Map(CATALOG_CATEGORIES.map((category) => [category.id, category.label.toLowerCase()]));
  return entries.filter((entry) =>
    [entry.name, entry.description, labels.get(entry.category) ?? ''].some((text) => text.toLowerCase().includes(needle)),
  );
}

/** vela://extensions/#install=<id> starts the install + review flow on that page. */
export function installHashId(hash: string): string | null {
  const match = /^#install=([a-p]{32})$/.exec(hash);
  return match?.[1] ?? null;
}
