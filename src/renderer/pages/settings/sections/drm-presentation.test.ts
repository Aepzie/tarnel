import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DrmStatus } from '@shared/drm';
import { drmPresentation } from './drm-presentation';

const available: DrmStatus = {
  enabled: true,
  enabledAtStartup: true,
  state: 'available',
  runtime: 'castlabs',
  componentVersion: '4.10.0',
  emeAvailable: true,
  restartRequired: false,
  failure: null,
  platform: 'win32',
  serviceVerified: false,
};

test('DRM cannot appear available while the selected setting is still being saved', () => {
  const view = drmPresentation(available, false);
  assert.equal(view.kind, 'saving');
  assert.equal(view.canRestart, false);
});

test('turning DRM off keeps the restart warning until native EME is disabled by restart', () => {
  const view = drmPresentation({ ...available, enabled: false, state: 'restart-required', restartRequired: true }, false);
  assert.equal(view.kind, 'restart');
  assert.equal(view.canRestart, true);
  assert.match(view.description, /nach einem Neustart/);
  assert.match(view.description, /bis dahin weiterhin verwendet/);
});

test('turning DRM on requires restart before claiming component availability', () => {
  const view = drmPresentation({ ...available, enabledAtStartup: false, state: 'restart-required', restartRequired: true }, true);
  assert.equal(view.kind, 'restart');
  assert.equal(view.canRestart, true);
  assert.match(view.description, /aktivieren/);
});

test('a missing DRM runtime stays unavailable even when the user has enabled DRM', () => {
  const view = drmPresentation({ ...available, runtime: 'standard', state: 'unsupported', componentVersion: null, emeAvailable: false, failure: 'runtime-missing' }, true);
  assert.equal(view.kind, 'unavailable');
  assert.equal(view.canRestart, false);
  assert.match(view.description, /Vela-Version/);
});

test('a missing runtime is not presented as something a restart can enable', () => {
  const view = drmPresentation({ ...available, runtime: 'standard', state: 'unsupported', enabledAtStartup: false, restartRequired: true, componentVersion: null, emeAvailable: false, failure: 'runtime-missing' }, true);
  assert.equal(view.kind, 'unavailable');
  assert.equal(view.canRestart, false);
});

test('available components never claim that Netflix playback has been verified', () => {
  const view = drmPresentation(available, true);
  assert.equal(view.kind, 'available');
  assert.equal(view.canRestart, false);
  assert.match(view.description, /Netflix.*nicht verifiziert/);
});

test('disabled after restart does not offer another restart', () => {
  const view = drmPresentation({ ...available, enabled: false, enabledAtStartup: false, state: 'disabled', componentVersion: null, emeAvailable: false }, false);
  assert.equal(view.kind, 'disabled');
  assert.equal(view.canRestart, false);
});

test('component initialization and failure remain distinct from availability', () => {
  assert.equal(drmPresentation({ ...available, state: 'initializing', componentVersion: null, emeAvailable: false }, true).kind, 'loading');
  for (const failure of ['component-failed', 'component-timeout', 'eme-unavailable', 'startup-blocked'] as const) {
    const view = drmPresentation({ ...available, state: 'unavailable', failure, emeAvailable: false }, true);
    assert.equal(view.kind, 'unavailable', failure);
    assert.equal(view.canRestart, failure === 'startup-blocked', failure);
    assert.ok(view.description.length > 0);
  }
});
