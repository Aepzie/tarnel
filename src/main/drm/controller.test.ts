import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrmController, type CdmComponents, type DrmControllerOptions } from './controller';

function runtime(version: string | null = '4.10.3050.0') {
  let calls = 0;
  const api: CdmComponents = {
    WIDEVINE_CDM_ID: 'widevine', updatesEnabled: false,
    status: (): ReturnType<CdmComponents['status']> => version ? { widevine: { status: 'updated', title: 'Widevine', version } } : {},
    whenReady: async (required) => {
      calls++;
      assert.deepEqual(required, ['widevine']);
      return [{ id: 'widevine', status: 'updated', title: 'Widevine', version }];
    },
  };
  return { api, calls: () => calls };
}
function options(patch: Partial<DrmControllerOptions> = {}): DrmControllerOptions {
  return { enabled: true, components: runtime().api, platform: 'win32', arch: 'x64', probe: async () => true, changed: () => {}, ...patch };
}

test('disabled startup does no component or EME work; selecting on only schedules restart', async () => {
  const { api, calls } = runtime();
  let probes = 0;
  const controller = new DrmController(options({ enabled: false, components: api, probe: async () => { probes++; return true; } }));
  await controller.start();
  assert.equal(calls(), 0);
  assert.equal(probes, 0);
  controller.setEnabled(true);
  assert.equal(controller.status().state, 'restart-required');
  assert.equal(controller.status().emeAvailable, false);
  assert.equal(api.updatesEnabled, false);
  controller.setEnabled(false);
  assert.equal(controller.status().state, 'disabled');
});

test('standard runtime cannot claim availability even when the preference is enabled', async () => {
  const controller = new DrmController(options({ components: null }));
  await controller.start();
  assert.equal(controller.status().state, 'unavailable');
  assert.equal(controller.status().failure, 'runtime-missing');
  assert.equal(controller.status().restartRequired, false);
});

test('CDM plus successful EME probe is available but never Netflix verified', async () => {
  const { api, calls } = runtime();
  const controller = new DrmController(options({ components: api }));
  await Promise.all([controller.start(), controller.start()]);
  assert.equal(calls(), 1);
  assert.equal(controller.status().state, 'available');
  assert.equal(controller.status().componentVersion, '4.10.3050.0');
  assert.equal(controller.status().emeAvailable, true);
  assert.equal(controller.status().serviceVerified, false);
  assert.equal(api.updatesEnabled, true);
  controller.setEnabled(false);
  assert.equal(api.updatesEnabled, false);
  assert.equal(controller.status().state, 'restart-required');
  assert.equal(controller.status().enabled, false);
});

test('installed CDM without usable EME is reported as unavailable', async () => {
  const controller = new DrmController(options({ probe: async () => false }));
  await controller.start();
  assert.equal(controller.status().state, 'unavailable');
  assert.equal(controller.status().failure, 'eme-unavailable');
});

test('ECS warm-start status new is usable only after the EME probe succeeds', async () => {
  const api = runtime().api;
  api.whenReady = async () => [{ id: 'widevine', status: 'new', title: 'Widevine', version: '4.10.3112.0' }];
  const ready = new DrmController(options({ components: api }));
  await ready.start();
  assert.equal(ready.status().state, 'available');
  const failed = new DrmController(options({ components: api, probe: async () => false }));
  await failed.start();
  assert.equal(failed.status().state, 'unavailable');
});

test('missing version and installation rejection fail closed', async () => {
  const missing = new DrmController(options({ components: runtime(null).api }));
  await missing.start();
  assert.equal(missing.status().state, 'unavailable');
  const api = runtime().api;
  api.whenReady = async () => { throw new Error('download failed with private path'); };
  const failed = new DrmController(options({ components: api }));
  await failed.start();
  assert.equal(failed.status().failure, 'component-failed');
  assert.equal(JSON.stringify(failed.status()).includes('private path'), false);
});

test('hung installation times out and a late success cannot grant readiness', async () => {
  const api = runtime().api;
  let finish!: () => void;
  api.whenReady = () => new Promise((resolve) => { finish = () => resolve([{ id: 'widevine', status: 'updated', title: 'Widevine', version: '4.10.1.0' }]); });
  const controller = new DrmController(options({ components: api, timeoutMs: 10 }));
  await controller.start();
  assert.equal(controller.status().failure, 'component-timeout');
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.status().emeAvailable, false);
});

test('disabling during installation prevents a late readiness result and stops updates', async () => {
  const api = runtime().api;
  let finish!: () => void;
  api.whenReady = () => new Promise((resolve) => { finish = () => resolve([{ id: 'widevine', status: 'updated', title: 'Widevine', version: '4.10.1.0' }]); });
  const controller = new DrmController(options({ components: api }));
  const pending = controller.start();
  controller.setEnabled(false);
  finish();
  await pending;
  assert.equal(controller.status().emeAvailable, false);
  assert.equal(controller.status().state, 'restart-required');
  assert.equal(api.updatesEnabled, false);
});

test('unsupported platforms and explicit startup blocks cannot activate components', async () => {
  const unsupported = new DrmController(options({ platform: 'freebsd' }));
  await unsupported.start();
  assert.equal(unsupported.status().state, 'unsupported');
  const blocked = new DrmController(options({ startupBlocked: true }));
  await blocked.start();
  assert.equal(blocked.status().failure, 'startup-blocked');
});
