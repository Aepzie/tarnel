import type { SpaceId } from './types';

interface ClosableTab {
  id: number;
  spaceId: SpaceId;
  url: string;
}

export function isStartPageUrl(url: string): boolean {
  return url.startsWith('tarnel://newtab');
}

/**
 * The start page that is the only tab of its space cannot be closed: closing it would just
 * reopen the start page. A lone website tab stays closable (it turns into the start page).
 */
export function isLoneStartPage(tab: ClosableTab, tabs: readonly Pick<ClosableTab, 'id' | 'spaceId'>[]): boolean {
  if (!isStartPageUrl(tab.url)) return false;
  return !tabs.some((other) => other.spaceId === tab.spaceId && other.id !== tab.id);
}
