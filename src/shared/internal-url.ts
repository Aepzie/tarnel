/**
 * Internal pages live on tarnel:// (tarnel://settings, tarnel://newtab, …). vela:// is the scheme
 * from before the rename and stays a legacy alias: old bookmarks, history entries, restored
 * sessions and command-line URLs are mapped to the same tarnel:// page. Pure: no electron imports.
 */
export const INTERNAL_SCHEME = 'tarnel';
export const LEGACY_INTERNAL_SCHEME = 'vela';
export const INTERNAL_ORIGIN_PREFIX = `${INTERNAL_SCHEME}://`;

const LEGACY_PREFIX = /^vela:/i;
const INTERNAL_PREFIX = /^(tarnel|vela):/i;

/** tarnel:// or the legacy vela:// alias. */
export function isInternalUrl(url: string): boolean {
  return INTERNAL_PREFIX.test(url);
}

export function isLegacyInternalUrl(url: string): boolean {
  return LEGACY_PREFIX.test(url);
}

/** Maps a legacy vela:… URL to the same tarnel:… URL; everything else is returned unchanged. */
export function canonicalInternalUrl(url: string): string {
  return LEGACY_PREFIX.test(url) ? INTERNAL_SCHEME + url.slice(LEGACY_INTERNAL_SCHEME.length) : url;
}
