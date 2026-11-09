/**
 * The Vela mark — single source of truth for every logo in the app and in the build.
 *
 * A sail (Vela is the "Sails" constellation) cut by one slanted gap into two floating pieces: a
 * small accent cap and a white body, like two islands drifting apart in the wind. The luff and foot
 * are straight, the leech is one circular arc (r 700 before rounding, centred at 62.4 / 829.7), and
 * the gap rises 0.26 to the right. Every corner is rounded by 18 so the pieces read as islands.
 *
 * Coordinates live in a 1024 box. The glyph's optical centre is (512, 512); its bounding box sits
 * 20 units right of centre because a sail's weight is on the mast side.
 *
 * Consumers: scripts/icons.mjs (build/icon.svg, icon-mono.svg, every PNG, .ico and .icns),
 * the settings VelaMark/VelaAppIcon, the new-tab LogoHero and the vela:// page favicons.
 * Change the paths here, then run `npm run icons`.
 */

/** The accent cap (upper piece). */
export const BRAND_CAP_PATH =
  'M308.2 155.1A718 718 0 0 1 571.1 323.1A18 18 0 0 1 562.9 353.2L306.5 419.8A18 18 0 0 1 284 402.4L284 172A18 18 0 0 1 308.2 155.1Z';

/** The sail body (lower piece). */
export const BRAND_BODY_PATH =
  'M297.5 484.2L623.2 399.5A18 18 0 0 1 642.2 406.3A718 718 0 0 1 780 852.6A18 18 0 0 1 762 870L302 870A18 18 0 0 1 284 852L284 501.6A18 18 0 0 1 297.5 484.2Z';

/** Square viewBox around the glyph alone (optically centred, ~3% padding). */
export const BRAND_GLYPH_VIEWBOX = '132 132 760 760';

/** Default Space blue (`--accent-space` in globals.css); the app icon always uses this. */
export const BRAND_ACCENT = '#60a5fa';
export const BRAND_INK = '#f5f7fa';
export const BRAND_TILE = '#0c0d11';

/** Glyph scale inside the tile: the sail spans ~63% of the tile height. */
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

/** The full-colour app icon as a standalone SVG document (1024×1024). */
export function brandIconSvg(shape: BrandTileShape = 'square'): string {
  const { inset, radius, shadow } = FRAMES[shape];
  const size = 1024 - inset * 2;
  const scale = (GLYPH_SCALE * size) / 1024;
  const rect = (extra: string): string =>
    `<rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}" ${extra}/>`;
  const ring = inset + 3;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">',
    '<title>Vela</title>',
    '<defs>',
    `<radialGradient id="vela-glow" cx="50%" cy="30%" r="72%"><stop offset="0" stop-color="${BRAND_ACCENT}" stop-opacity="0.24"/><stop offset="1" stop-color="${BRAND_ACCENT}" stop-opacity="0"/></radialGradient>`,
    '<linearGradient id="vela-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.2"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#fff" stop-opacity="0.04"/></linearGradient>',
    shadow
      ? '<filter id="vela-shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.3"/></filter>'
      : '',
    '</defs>',
    rect(`fill="${BRAND_TILE}"${shadow ? ' filter="url(#vela-shadow)"' : ''}`),
    rect('fill="url(#vela-glow)"'),
    `<rect x="${ring}" y="${ring}" width="${size - 6}" height="${size - 6}" rx="${radius - 3}" fill="none" stroke="url(#vela-rim)" stroke-width="6"/>`,
    `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">`,
    `<path d="${BRAND_BODY_PATH}" fill="${BRAND_INK}"/>`,
    `<path d="${BRAND_CAP_PATH}" fill="${BRAND_ACCENT}"/>`,
    '</g>',
    '</svg>',
  ].join('');
}

/** Single-colour glyph (both pieces in currentColor) as a standalone SVG document. */
export function brandGlyphSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRAND_GLYPH_VIEWBOX}" width="64" height="64" fill="currentColor">`,
    '<title>Vela</title>',
    `<path d="${BRAND_BODY_PATH}"/>`,
    `<path d="${BRAND_CAP_PATH}"/>`,
    '</svg>',
  ].join('');
}

/** data: URL of the full-colour icon (favicons, <img>). */
export function brandIconDataUrl(shape: BrandTileShape = 'square'): string {
  return `data:image/svg+xml,${encodeURIComponent(brandIconSvg(shape))}`;
}
