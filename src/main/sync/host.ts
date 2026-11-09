import type { Settings, Space, SpaceColor } from '../../shared/types';

/** userData/<file>: small config (read at boot to decide whether to load the engine at all). */
export const SYNC_CONFIG_FILE = 'sync.json';

/** What the sync engine needs from the browser. Implemented in loader.ts (main bundle). */
export interface SyncHost {
  userDataDir: string;
  deviceName: string;
  secureStorageAvailable(): boolean;
  /** OS-protected encryption at rest (Electron safeStorage); base64 in / out. */
  protect(plain: string): string;
  unprotect(sealed: string): string;

  getSettings(): Settings;
  applySettings(patch: Partial<Settings>): void;

  listSpaces(): Space[];
  /** Creates (with this id) or updates a persistent space. */
  upsertSpace(id: string, fields: { name: string; color: SpaceColor; proxy: string }): void;
  removeSpace(id: string): Promise<void>;

  listTabs(): { url: string; title: string; spaceId: string; pinned: boolean }[];

  listHistory(limit: number): { url: string; title: string; visits: number; lastVisit: number }[];
  mergeHistory(entries: { url: string; title: string; visits: number; lastVisit: number }[]): void;

  /** Called once; `cb` fires on local settings / spaces / tab changes. */
  onLocalChange(cb: (source: 'settings' | 'spaces' | 'tabs') => void): void;
}
