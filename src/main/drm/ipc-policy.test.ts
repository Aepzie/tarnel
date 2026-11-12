import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isInternalPageSender, isSettingsPage, validateDrmSettingsPatch } from './ipc-policy';

test('internal IPC requires a registered tab and a top-level internal frame', () => {
  assert.equal(isInternalPageSender({ parent: null, url: 'tarnel://settings/privacy' }, 0), true);
  for (const [frame, tabId] of [
    [null, 1], [{ parent: {}, url: 'tarnel://settings' }, 1],
    [{ parent: null, url: 'tarnel://settings' }, null],
    [{ parent: null, url: 'https://settings/' }, 1],
  ] as const) assert.equal(isInternalPageSender(frame, tabId), false);
});

test('DRM consent rejects malformed values for both privileged chrome and pages', () => {
  for (const source of ['chrome', 'page'] as const) {
    for (const drmEnabled of [undefined, null, 'true', 1, {}, []]) {
      assert.throws(() => validateDrmSettingsPatch({ drmEnabled }, source, 'tarnel://settings/'), TypeError);
    }
    for (const drmEnabled of [false, true]) {
      assert.doesNotThrow(() => validateDrmSettingsPatch({ drmEnabled }, source, 'tarnel://settings/'));
    }
  }
});

test('only Settings pages may change DRM consent while chrome remains privileged', () => {
  for (const url of ['tarnel://history/', 'https://settings/', 'tarnel://settings.evil/', 'tarnel://user@settings/', 'file:///settings']) {
    assert.equal(isSettingsPage(url), false);
    assert.throws(() => validateDrmSettingsPatch({ drmEnabled: true }, 'page', url), /Settings/);
    assert.doesNotThrow(() => validateDrmSettingsPatch({ drmEnabled: true }, 'chrome', url));
    assert.doesNotThrow(() => validateDrmSettingsPatch({ theme: 'dark' }, 'page', url));
  }
  assert.equal(isSettingsPage('tarnel://settings/privacy?section=drm'), true);
});
