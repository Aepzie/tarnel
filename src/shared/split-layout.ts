import type { ContentBounds } from './types';

/**
 * Split view geometry, shared by main (places the page views) and the chrome (draws pane frames,
 * dividers and the focus ring in the gaps) so both always agree to the pixel.
 */

export const SPLIT_MAX_PANES = 4;
/** Gap between panes: the same 8px that separates every other island. */
export const SPLIT_GAP = 8;
/** Panes never get narrower / shorter than this while the viewport allows it. */
export const SPLIT_MIN_PANE = 220;
export const SPLIT_DEFAULT_RATIO = 0.5;

export interface SplitGeometry {
  panes: ContentBounds[];
  /** Vertical divider (column gap) and, for 3–4 panes, the horizontal one. Relative to the bounds origin. */
  columnGap: ContentBounds;
  rowGap: ContentBounds | null;
}

/** Clamp a stored ratio to [0.1, 0.9]; anything invalid becomes 0.5. */
export function sanitizeRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SPLIT_DEFAULT_RATIO;
  return Math.min(0.9, Math.max(0.1, value));
}

/** First segment of `total` px split by `ratio` with a gap, honoring the min pane size when possible. */
function firstSize(total: number, ratio: number): number {
  const free = Math.max(0, total - SPLIT_GAP);
  const min = Math.min(SPLIT_MIN_PANE, Math.floor(free / 2));
  return Math.round(Math.min(free - min, Math.max(min, free * ratio)));
}

/** Pane rects (relative to `bounds` origin when `relative`, else absolute) for `count` panes. */
export function splitGeometry(bounds: ContentBounds, count: number, ratioX: number, ratioY: number, relative = false): SplitGeometry {
  const ox = relative ? 0 : bounds.x;
  const oy = relative ? 0 : bounds.y;
  const width = Math.max(0, Math.round(bounds.width));
  const height = Math.max(0, Math.round(bounds.height));
  const left = firstSize(width, ratioX);
  const right = Math.max(0, width - left - SPLIT_GAP);
  const top = firstSize(height, ratioY);
  const bottom = Math.max(0, height - top - SPLIT_GAP);
  const rx = ox + left + SPLIT_GAP;
  const by = oy + top + SPLIT_GAP;
  const columnGap = { x: left, y: 0, width: SPLIT_GAP, height };

  if (count <= 2) {
    return {
      panes: [
        { x: ox, y: oy, width: left, height },
        { x: rx, y: oy, width: right, height },
      ],
      columnGap,
      rowGap: null,
    };
  }
  if (count === 3) {
    return {
      panes: [
        { x: ox, y: oy, width: left, height },
        { x: rx, y: oy, width: right, height: top },
        { x: rx, y: by, width: right, height: bottom },
      ],
      columnGap,
      rowGap: { x: left + SPLIT_GAP, y: top, width: right, height: SPLIT_GAP },
    };
  }
  return {
    panes: [
      { x: ox, y: oy, width: left, height: top },
      { x: rx, y: oy, width: right, height: top },
      { x: ox, y: by, width: left, height: bottom },
      { x: rx, y: by, width: right, height: bottom },
    ],
    columnGap,
    rowGap: { x: 0, y: top, width, height: SPLIT_GAP },
  };
}
