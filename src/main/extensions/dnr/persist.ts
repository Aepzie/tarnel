import { app } from 'electron';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createStore, type JsonStore } from '../../store';
import type { Rule } from './types';

/**
 * Per Space and extension: userData/dnr/<spaceId>/<extensionId>.json. Like Chrome's per-profile
 * state, it survives restarts; enabled rulesets reset to the manifest defaults when the extension's
 * version changes (as Chrome does on update). Session rules are never written.
 */
export interface DnrPersisted {
  version: string | null;
  /** null = the manifest's `enabled` flags. */
  enabledRulesets: string[] | null;
  /** Static rule ids switched off with updateStaticRules, per ruleset. */
  disabledStaticRules: Record<string, number[]>;
  dynamicRules: Rule[];
  displayActionCountAsBadgeText: boolean;
}

const DEFAULTS: DnrPersisted = {
  version: null,
  enabledRulesets: null,
  disabledStaticRules: {},
  dynamicRules: [],
  displayActionCountAsBadgeText: false,
};

const stores = new Map<string, JsonStore<DnrPersisted>>();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function key(spaceId: string, extensionId: string): string {
  return `${spaceId}/${extensionId}`;
}

export function dnrStore(spaceId: string, extensionId: string): JsonStore<DnrPersisted> {
  if (!SAFE_ID.test(spaceId) || !SAFE_ID.test(extensionId)) throw new Error('Invalid id');
  const id = key(spaceId, extensionId);
  let store = stores.get(id);
  if (!store) {
    store = createStore<DnrPersisted>(`dnr/${id}`, { ...DEFAULTS });
    stores.set(id, store);
  }
  return store;
}

/** Remove an extension's state in every Space (the extension was uninstalled). */
export async function deletePersisted(extensionId: string, spaceIds: readonly string[]): Promise<void> {
  if (!SAFE_ID.test(extensionId)) return;
  for (const spaceId of spaceIds) {
    if (!SAFE_ID.test(spaceId)) continue;
    const store = stores.get(key(spaceId, extensionId));
    store?.flush();
    stores.delete(key(spaceId, extensionId));
    await rm(join(app.getPath('userData'), 'dnr', spaceId, `${extensionId}.json`), { force: true }).catch(() => undefined);
  }
}
