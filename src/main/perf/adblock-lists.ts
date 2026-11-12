/**
 * Which filter lists the adblock engine is built from (pure: no electron, unit-tested).
 *
 * Base: Ghostery's "ads and tracking" preset (EasyList, EasyPrivacy, Peter Lowe, uBO filters /
 * privacy / quick-fixes / badware / unbreak / resource-abuse). Ghostery serves the uBO lists from a
 * mirror in its own repository that lags uBO by weeks and stops at filters-2024. YouTube changes its
 * ad delivery every few days and uBO answers in quick-fixes.txt / filters.txt (fetch/XHR response
 * pruning, request editing), so the uBO lists are taken from uBO's own publication instead, plus
 * the yearly lists the mirror lacks. The scriptlets those rules call come from Ghostery's
 * resources.json, which tracks uBO's scriptlets.
 *
 * On top comes Tarnel's own bundled list (lists/tarnel-extra.txt, copied to dist/main by the
 * build): ad / analytics / device telemetry hosts the public browser lists miss, versioned with the
 * app and keyed into the engine cache by content hash (listSetKey).
 */

const GHOSTERY_UBO_MIRROR = /\/ublock-origin\/([a-z0-9-]+\.txt)$/;
const UBO_LISTS = 'https://ublockorigin.github.io/uAssets/filters/';
const UBO_EXTRA_LISTS = ['filters-2025.txt', 'filters-2026.txt'];

/** Part of the engine cache key: bump whenever the remote list set changes. */
export const LIST_SET = 'ads-tracking+ubo-upstream-2025-2026';

export interface ListSource {
  url: string;
  /** Where to get the list if `url` fails (Ghostery's mirror); null when the list is optional. */
  fallback: string | null;
}

/** Ghostery preset URLs with every mirrored uBO list pointed at uBO's own publication. */
export function engineListSources(preset: readonly string[]): ListSource[] {
  const sources = preset.map((url): ListSource => {
    const mirrored = GHOSTERY_UBO_MIRROR.exec(url);
    return mirrored ? { url: `${UBO_LISTS}${mirrored[1]}`, fallback: url } : { url, fallback: null };
  });
  for (const name of UBO_EXTRA_LISTS) {
    const url = `${UBO_LISTS}${name}`;
    if (!sources.some((source) => source.url === url)) sources.push({ url, fallback: null });
  }
  return sources;
}

export function listSetKey(extraHash: string): string {
  return `${LIST_SET}+extra-${extraHash}`;
}
