import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adblockRefreshAfterMs,
  batteryDelayDivisor,
  effectiveMemorySaver,
  forcedReading,
  parseBatteryLevel,
  resolveBatterySaver,
} from './battery-policy';

test('off is never active, always is always active', () => {
  assert.equal(resolveBatterySaver('off', { onBattery: true, level: 0.05 }), false);
  assert.equal(resolveBatterySaver('always', { onBattery: false, level: null }), true);
});

test('battery mode follows the power source', () => {
  assert.equal(resolveBatterySaver('battery', { onBattery: true, level: null }), true);
  assert.equal(resolveBatterySaver('battery', { onBattery: false, level: 0.05 }), false);
});

test('low mode needs battery power and a known level under 20 %', () => {
  assert.equal(resolveBatterySaver('low', { onBattery: true, level: 0.19 }), true);
  assert.equal(resolveBatterySaver('low', { onBattery: true, level: 0.2 }), false);
  assert.equal(resolveBatterySaver('low', { onBattery: true, level: null }), false);
  assert.equal(resolveBatterySaver('low', { onBattery: false, level: 0.05 }), false);
});

test('active saver halves delays, strengthens balanced memory saver, slows adblock refresh', () => {
  assert.equal(batteryDelayDivisor(true), 2);
  assert.equal(batteryDelayDivisor(false), 1);
  assert.equal(effectiveMemorySaver('balanced', true), 'maximum');
  assert.equal(effectiveMemorySaver('off', true), 'off');
  assert.equal(effectiveMemorySaver('balanced', false), 'balanced');
  assert.equal(adblockRefreshAfterMs(1000, true), 3000);
  assert.equal(adblockRefreshAfterMs(1000, false), 1000);
});

test('battery level input is validated', () => {
  assert.equal(parseBatteryLevel(0.5), 0.5);
  assert.equal(parseBatteryLevel(7), 1);
  assert.equal(parseBatteryLevel(-1), 0);
  assert.equal(parseBatteryLevel(Number.NaN), null);
  assert.equal(parseBatteryLevel('0.5'), null);
});

test('dev overrides', () => {
  assert.deepEqual(forcedReading({}), {});
  assert.deepEqual(forcedReading({ VELA_FORCE_BATTERY: '1', VELA_FORCE_BATTERY_LEVEL: '0.1' }), { onBattery: true, level: 0.1 });
  assert.deepEqual(forcedReading({ VELA_FORCE_BATTERY: '0', VELA_FORCE_BATTERY_LEVEL: 'x' }), { onBattery: false });
});
