import { deleteHistorySince } from './history';
import { getSettings } from './settings';
import { listSpaces } from './spaces';
import { getBrowserState, removeSpaceWithTabs, toggleMute } from './tabs';
import { disconnectAll } from './vpn';
import { getMainWindow } from './window';

/** How far back "also clear recent history" reaches. */
export const PANIC_HISTORY_WINDOW_MS = 15 * 60_000;

let running = false;

/**
 * Panic button: hide the window first, then mute every tab, drop all VPN routes and close every
 * Burner Space (wiped by the normal Space disposal). Nothing persistent is deleted unless the
 * "also clear the last 15 minutes of history" setting is on.
 */
export async function panic(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.minimize();
    for (const tab of getBrowserState().tabs) if (!tab.muted) toggleMute(tab.id);
    try {
      disconnectAll();
    } catch {
      /* VPN not initialised: nothing to drop */
    }
    const burners = listSpaces().filter((space) => space.ephemeral);
    for (const space of burners) await removeSpaceWithTabs(space.id).catch(() => undefined);
    if (getSettings().panicClearRecentHistory) deleteHistorySince(Date.now() - PANIC_HISTORY_WINDOW_MS);
  } finally {
    running = false;
  }
}
