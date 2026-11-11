/** Which tabs the auto-archive takes. Pure: no Electron. */

export interface ArchiveCandidate {
  id: number;
  url: string;
  lastActiveAt: number;
  pinned: boolean;
  /** On screen (active tab or a pane of the visible split). */
  active: boolean;
  audible: boolean;
  /** Microphone/camera in use. */
  capturing: boolean;
  downloading: boolean;
}

/** Cap per check so a long sleep/resume doesn't empty the whole strip in one go. */
export const MAX_ARCHIVE_PER_TICK = 25;

const START_PAGE = /^vela:\/\/newtab\b/i;

export function isArchivable(tab: ArchiveCandidate): boolean {
  return !tab.pinned && !tab.active && !tab.audible && !tab.capturing && !tab.downloading && !START_PAGE.test(tab.url);
}

/** Tabs idle for at least `afterMs`, oldest first. `afterMs <= 0` disables the auto-archive. */
export function pickArchiveTargets(tabs: readonly ArchiveCandidate[], now: number, afterMs: number): number[] {
  if (!(afterMs > 0)) return [];
  return tabs
    .filter((tab) => isArchivable(tab) && now - tab.lastActiveAt >= afterMs)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    .slice(0, MAX_ARCHIVE_PER_TICK)
    .map((tab) => tab.id);
}

export function archiveAfterMs(hours: number): number {
  return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 0;
}
