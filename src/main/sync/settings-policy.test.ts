import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSyncSetting, remoteSettingsPatch } from './settings-policy';
import type { SyncRecord } from './records';

const remote = (name: string, v: unknown, d = 'remote'): SyncRecord => ({ k: `s/${name}`, v, d, c: 1 });

test('device-local DRM consent cannot be exported or imported, including through a remote prototype', () => {
  assert.equal(canSyncSetting('drmEnabled'), false);
  const patch = remoteSettingsPatch([
    remote('__proto__', { drmEnabled: true }), remote('drmEnabled', true),
    remote('constructor', { prototype: { drmEnabled: true } }), remote('theme', 'dark'),
  ], 'local');
  assert.equal(patch.theme, 'dark');
  assert.equal(patch.drmEnabled, undefined);
  assert.equal(Object.getPrototypeOf(patch), null);
  assert.deepEqual(Object.keys(patch), ['theme']);
});

test('sync preserves eligible foreign settings and ignores local records, tombstones and unknown keys', () => {
  assert.equal(canSyncSetting('theme'), true);
  assert.equal(canSyncSetting('windowMaterial'), false);
  const patch = remoteSettingsPatch([
    remote('theme', 'light'), remote('theme', 'dark', 'local'), remote('searchEngine', null),
    remote('windowMaterial', 'none'), remote('futureSetting', true),
    { k: 'sp/theme', v: 'dark', d: 'remote', c: 1 },
  ], 'local');
  assert.deepEqual({ ...patch }, { theme: 'light' });
});
