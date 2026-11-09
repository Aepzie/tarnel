import { OMNI_MAX, OMNI_MIN, PILL_COMFORT, PILL_ICON_ONLY, PILL_MAX, PILL_MIN } from './TabItem';

const GAP = 4;
const STRIP_PADDING = 8;
const NEW_TAB_BUTTON = 32;
const PINNED_SEPARATOR = 9;
/** Share of the strip the omnibox aims for before it starts yielding space to inactive tabs. */
const OMNI_SHARE = 0.4;

export interface TabWidths {
  omnibox: number;
  pill: number;
  /** Inactive tabs are narrow enough that only the favicon fits. */
  iconOnly: boolean;
}

export interface TabWidthInput {
  available: number;
  pinnedInactive: number;
  inactive: number;
  hasActive: boolean;
  separator: boolean;
  /** Fixed extra width taken by other strip children (group chips incl. their gaps). */
  reserved?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Chrome-style width distribution: the omnibox takes a comfortable share, inactive tabs split the rest
 * equally up to PILL_MAX. When crowded the omnibox yields first (down to OMNI_MIN) so titles stay
 * readable; only then do inactive pills shrink toward icon-only. With spare room the omnibox grows.
 */
export function computeTabWidths({ available, pinnedInactive, inactive, hasActive, separator, reserved = 0 }: TabWidthInput): TabWidths {
  const children = pinnedInactive + inactive + (hasActive ? 1 : 0) + (separator ? 1 : 0) + 1;
  const fixed =
    STRIP_PADDING + NEW_TAB_BUTTON + Math.max(0, children - 1) * GAP + pinnedInactive * PILL_MIN + (separator ? PINNED_SEPARATOR : 0) + reserved;
  const free = Math.max(0, available - fixed);

  if (!hasActive) {
    const pill = inactive > 0 ? clamp(Math.floor(free / inactive), PILL_MIN, PILL_MAX) : PILL_MAX;
    if (pill < PILL_ICON_ONLY) return { omnibox: OMNI_MIN, pill: PILL_MIN, iconOnly: true };
    return { omnibox: OMNI_MIN, pill, iconOnly: false };
  }
  if (inactive === 0) return { omnibox: clamp(free, OMNI_MIN, OMNI_MAX), pill: PILL_MAX, iconOnly: false };

  let omnibox = clamp(free * OMNI_SHARE, OMNI_MIN, OMNI_MAX);
  let pill = (free - omnibox) / inactive;

  if (pill < PILL_COMFORT) {
    omnibox = clamp(free - inactive * PILL_COMFORT, OMNI_MIN, omnibox);
    pill = (free - omnibox) / inactive;
  } else if (pill > PILL_MAX) {
    pill = PILL_MAX;
    omnibox = clamp(free - inactive * PILL_MAX, omnibox, OMNI_MAX);
  }

  if (pill < PILL_ICON_ONLY) {
    return { omnibox: Math.floor(clamp(free - inactive * PILL_MIN, OMNI_MIN, OMNI_MAX)), pill: PILL_MIN, iconOnly: true };
  }
  return { omnibox: Math.floor(omnibox), pill: clamp(Math.floor(pill), PILL_MIN, PILL_MAX), iconOnly: false };
}
