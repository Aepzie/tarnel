/**
 * The Tarnel mark — single source of truth for every logo in the app and in the build.
 *
 * A tarn: a two-peak mountain (45° slopes, main peak left of centre) above a still mountain lake,
 * with its reflection drawn as three accent bands that shorten towards the bottom, the last one
 * under the main peak. Tarnel = "tarn" (still lake) + "tarnen" (to cloak). Corners are rounded
 * by 17.5 so the mountain reads as one calm shape.
 *
 * Coordinates live in a 1024 box (drawn on a 24 grid, 35 units per cell). The glyph's optical
 * centre is (512, 512).
 *
 * Consumers: scripts/icons.mjs (build/icon.svg, icon-mono.svg, every PNG, .ico and .icns),
 * the settings BrandMark/BrandAppIcon, the new-tab LogoHero, the internal page favicons and the
 * Android drawables (android/scripts/brand-mark.mjs). Change the paths here, then run
 * `npm run icons`.
 */

/** The reflection (three accent bands on the water). */
export const BRAND_CAP_PATH =
  'M192.6 564.5H831.4A30.625 30.625 0 0 1 831.4 625.8H192.6A30.625 30.625 0 0 1 192.6 564.5ZM310.8 669.5H660.8A26.25 26.25 0 0 1 660.8 722H310.8A26.25 26.25 0 0 1 310.8 669.5ZM411.4 765.8H472.6A21.875 21.875 0 0 1 472.6 809.5H411.4A21.875 21.875 0 0 1 411.4 765.8Z';

/** The mountain. */
export const BRAND_BODY_PATH =
  'M179.5 503.3A17.5 17.5 0 0 1 167.1 473.4L429.6 210.9A17.5 17.5 0 0 1 454.4 210.9L564.5 321L622.1 263.4A17.5 17.5 0 0 1 646.9 263.4L856.9 473.4A17.5 17.5 0 0 1 844.5 503.3Z';

/** Square viewBox around the glyph alone (optically centred, ~3% padding). */
export const BRAND_GLYPH_VIEWBOX = '132 132 760 760';

/** Brand violet; the OS app icon always uses this. In-app copies may pass var(--accent-space). */
export const BRAND_ACCENT = '#a78bfa';
export const BRAND_INK = '#f4f4f5';
export const BRAND_TILE = '#18181b';

/** Glyph scale inside the tile: the mark spans ~61% of the tile. */
const GLYPH_SCALE = 0.9;

export type BrandTileShape = 'square' | 'mac';

interface TileFrame {
  inset: number;
  radius: number;
  shadow: boolean;
}

/**
 * square: full-bleed rounded tile (Windows, Linux, favicons, About).
 * mac: Apple's 824 squircle on a 1024 canvas with the standard 100 margin and drop shadow.
 */
const FRAMES: Record<BrandTileShape, TileFrame> = {
  square: { inset: 0, radius: 228, shadow: false },
  mac: { inset: 100, radius: 185, shadow: true },
};

/**
 * The full-colour app icon as a standalone SVG document (1024×1024): flat tile, hairline rim, white
 * mountain, accent reflection. The OS icon files always use BRAND_ACCENT; in-app copies may pass
 * `var(--accent-space)`.
 */
export function brandIconSvg(shape: BrandTileShape = 'square', accent: string = BRAND_ACCENT): string {
  const { inset, radius, shadow } = FRAMES[shape];
  const size = 1024 - inset * 2;
  const scale = (GLYPH_SCALE * size) / 1024;
  const rect = (extra: string): string =>
    `<rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}" ${extra}/>`;
  const ring = inset + 3;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">',
    '<title>Tarnel</title>',
    '<defs>',
    shadow
      ? '<filter id="tarnel-shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.3"/></filter>'
      : '',
    '</defs>',
    rect(`fill="${BRAND_TILE}"${shadow ? ' filter="url(#tarnel-shadow)"' : ''}`),
    `<rect x="${ring}" y="${ring}" width="${size - 6}" height="${size - 6}" rx="${radius - 3}" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="6"/>`,
    `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">`,
    `<path d="${BRAND_BODY_PATH}" fill="${BRAND_INK}"/>`,
    `<path d="${BRAND_CAP_PATH}" fill="${accent}"/>`,
    '</g>',
    '</svg>',
  ].join('');
}

/** Single-colour glyph (both pieces in currentColor) as a standalone SVG document. */
export function brandGlyphSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRAND_GLYPH_VIEWBOX}" width="64" height="64" fill="currentColor">`,
    '<title>Tarnel</title>',
    `<path d="${BRAND_BODY_PATH}"/>`,
    `<path d="${BRAND_CAP_PATH}"/>`,
    '</svg>',
  ].join('');
}

/** data: URL of the full-colour icon (favicons, <img>). */
export function brandIconDataUrl(shape: BrandTileShape = 'square'): string {
  return `data:image/svg+xml,${encodeURIComponent(brandIconSvg(shape))}`;
}
