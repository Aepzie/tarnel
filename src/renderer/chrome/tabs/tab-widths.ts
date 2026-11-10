import { PILL_ICON_ONLY, PILL_MAX, PILL_MIN } from './TabItem';

const GAP = 4;
const STRIP_PADDING = 8;
const NEW_TAB_BUTTON = 32;
const PINNED_SEPARATOR = 9;

export interface TabWidths {
  pill: number;
  /** Tabs are narrow enough that only the favicon fits. */
  iconOnly: boolean;
}

export interface TabWidthInput {
  available: number;
  /** Pinned tabs (always icon-only), active or not. */
  pinned: number;
  /** Unpinned tabs including the active one; split panes count as one tab each. */
  tabs: number;
  separator: boolean;
  /** Fixed extra width taken by other strip children (group chips incl. their gaps). */
  reserved?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Chrome-style width distribution: every unpinned tab — active or not — gets the same width, up to
 * PILL_MAX, shrinking evenly as tabs are added and collapsing to icon-only when crowded. Activation
 * never changes any width.
 */
export function computeTabWidths({ available, pinned, tabs, separator, reserved = 0 }: TabWidthInput): TabWidths {
  const children = pinned + tabs + (separator ? 1 : 0) + 1;
  const fixed = STRIP_PADDING + NEW_TAB_BUTTON + Math.max(0, children - 1) * GAP + pinned * PILL_MIN + (separator ? PINNED_SEPARATOR : 0) + reserved;
  const free = Math.max(0, available - fixed);
  const pill = tabs > 0 ? clamp(Math.floor(free / tabs), PILL_MIN, PILL_MAX) : PILL_MAX;
  if (pill < PILL_ICON_ONLY) return { pill: PILL_MIN, iconOnly: true };
  return { pill, iconOnly: false };
}
