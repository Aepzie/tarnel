import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDrmLaunchSwitches } from './startup';
function commandLine(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, hasSwitch: (name: string) => values.has(name), getSwitchValue: (name: string) => values.get(name) ?? '', appendSwitch: (name: string, value = '') => { values.set(name, value); } };
}
test('off launch natively rejects installed library CDMs, even with user supplied overrides', () => {
  const line = commandLine({ 'override-enabled-cdm-interface-version': '12' });
  applyDrmLaunchSwitches(line, false);
  assert.equal(line.values.get('override-enabled-cdm-interface-version'), '0');
  assert.equal(line.values.has('disable-component-update'), true);
});
test('opted-in startup leaves Chromium defaults and respects explicit administrator blocks', () => {
  const normal = commandLine();
  assert.equal(applyDrmLaunchSwitches(normal, true), false);
  assert.equal(normal.values.size, 0);
  const blocked = commandLine({ 'disable-component-update': '' });
  assert.equal(applyDrmLaunchSwitches(blocked, true), true);
});
