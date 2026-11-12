import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDrmLaunchSwitches, shouldDisableStockComponentUpdates } from './startup';
import { drmLaunchPolicy, drmHeaderPolicyRequired } from './policy';
import { DrmController } from './controller';
function commandLine(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, hasSwitch: (name: string) => values.has(name), getSwitchValue: (name: string) => values.get(name) ?? '', appendSwitch: (name: string, value = '') => { values.set(name, value); } };
}
test('off launch natively rejects installed library CDMs, even with user supplied overrides', () => {
  const line = commandLine({ 'override-enabled-cdm-interface-version': '12' });
  applyDrmLaunchSwitches(line, false, true);
  assert.equal(line.values.get('override-enabled-cdm-interface-version'), '0');
  assert.equal(line.values.has('disable-component-update'), true);
});
test('opted-in startup leaves Chromium defaults and respects explicit administrator blocks', () => {
  const normal = commandLine();
  assert.equal(applyDrmLaunchSwitches(normal, true, true), false);
  assert.equal(normal.values.size, 0);
  const blocked = commandLine({ 'disable-component-update': '' });
  assert.equal(applyDrmLaunchSwitches(blocked, true, true), true);
});

test('stock tuning and ECS consent gates have independent component update ownership', () => {
  const gated = { 'disable-component-update': '', 'override-enabled-cdm-interface-version': '0' };
  const cases: [boolean, boolean, boolean, string, Record<string, string>][] = [
    [false, false, false, 'x64', { 'disable-component-update': '' }],
    [false, true, false, 'x64', { 'disable-component-update': '' }],
    [false, false, true, 'x64', {}],
    [false, true, true, 'x64', {}],
    [true, false, false, 'x64', gated],
    [true, false, true, 'x64', gated],
    [true, true, false, 'x64', {}],
    [true, true, true, 'x64', {}],
    [true, true, false, 'ia32', gated],
    [true, true, true, 'ia32', gated],
  ];
  for (const [runtime, consent, noFlags, arch, expected] of cases) {
    const line = commandLine();
    applyDrmLaunchSwitches(line, drmLaunchPolicy(consent, runtime, 'win32', arch).enabled, runtime);
    if (shouldDisableStockComponentUpdates(runtime, noFlags)) line.appendSwitch('disable-component-update');
    assert.deepEqual(Object.fromEntries(line.values), expected, JSON.stringify({ runtime, consent, noFlags, arch }));
  }
});

test('document fence is latched to this launch and never follows a live toggle', () => {
  for (const currentConsent of [false, true]) {
    assert.equal(drmHeaderPolicyRequired(drmLaunchPolicy(false, true, 'win32', 'x64')), false);
    assert.equal(drmHeaderPolicyRequired(drmLaunchPolicy(true, false, 'win32', 'x64')), false);
    assert.equal(drmHeaderPolicyRequired(drmLaunchPolicy(true, true, 'freebsd', 'x64')), false);
    const launch = drmLaunchPolicy(true, true, 'win32', 'x64');
    const controller = new DrmController({ enabled: true, components: {
      WIDEVINE_CDM_ID: 'widevine', updatesEnabled: false,
      status: () => ({}), whenReady: async () => [],
    }, platform: 'win32', arch: 'x64', probe: async () => false, changed: () => {} });
    controller.setEnabled(currentConsent);
    assert.equal(controller.status().enabled, currentConsent);
    assert.equal(drmHeaderPolicyRequired(launch), true, `live=${currentConsent}`);
  }
});
