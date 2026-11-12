import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import type { SyncRecord } from './records';

/** Device-local choices, especially consent, must never be imported or exported. */
const LOCAL_ONLY_SETTINGS = new Set<string>(['windowMaterial', 'sidebarCollapsed', 'sidebarWidth', 'drmEnabled']);

export function canSyncSetting(name: string): name is keyof Settings {
  return Object.hasOwn(DEFAULT_SETTINGS, name) && !LOCAL_ONLY_SETTINGS.has(name);
}

export function remoteSettingsPatch(records: readonly SyncRecord[], deviceId: string): Partial<Settings> {
  // A remote s/__proto__ must never turn a local consent into an inherited patch property.
  const patch: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const record of records) {
    if (record.d === deviceId || record.v === null || !record.k.startsWith('s/')) continue;
    const name = record.k.slice(2);
    if (canSyncSetting(name)) patch[name] = record.v;
  }
  return patch as Partial<Settings>;
}
