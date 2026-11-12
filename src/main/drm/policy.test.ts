import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowsDrmPermission, drmLaunchPolicy } from './policy';

test('DRM launch never enables EME or component downloads without explicit local consent and a supported runtime', () => {
  assert.deepEqual(drmLaunchPolicy(false, true, 'win32', 'x64'), { enabled: false, supported: true, componentUpdates: false });
  assert.deepEqual(drmLaunchPolicy(true, false, 'win32', 'x64'), { enabled: false, supported: true, componentUpdates: false });
  assert.deepEqual(drmLaunchPolicy(true, true, 'win32', 'x64'), { enabled: true, supported: true, componentUpdates: true });
  assert.equal(drmLaunchPolicy(true, true, 'linux', 'arm64').enabled, true);
  assert.equal(drmLaunchPolicy(true, true, 'freebsd', 'x64').enabled, false);
  assert.equal(drmLaunchPolicy(true, true, 'win32', 'ia32').supported, false);
});

const request = { enabled: true, ready: true, ephemeral: false, isMainFrame: true, requestingUrl: 'https://video.example/watch', topUrl: 'https://video.example/' };
test('DRM permission allows only a ready, enabled, persistent Space with a matching HTTPS top-level origin', () => {
  assert.equal(allowsDrmPermission(request), true);
  for (const patch of [
    { enabled: false }, { ready: false }, { ephemeral: true }, { isMainFrame: false },
    { requestingUrl: 'http://video.example/' }, { requestingUrl: 'https://other.example/' },
    { requestingUrl: 'https://video.example:444/' }, { requestingUrl: 'data:text/html,test' },
    { requestingUrl: 'https://user:pass@video.example/' }, { requestingUrl: undefined },
    { topUrl: undefined }, { topUrl: 'file:///test.html' },
  ]) assert.equal(allowsDrmPermission({ ...request, ...patch }), false, JSON.stringify(patch));
});
