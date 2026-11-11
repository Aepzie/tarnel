import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanUserAgentValue, isValidUserAgent, randomUserAgent, userAgentPresets } from './user-agent';

test('validation accepts printable ASCII and rejects header injection', () => {
  assert.equal(cleanUserAgentValue(undefined, 'x'), 'x');
  assert.equal(cleanUserAgentValue('  Mozilla/5.0  '), 'Mozilla/5.0');
  assert.equal(cleanUserAgentValue(''), '');
  assert.throws(() => cleanUserAgentValue('a\r\nX-Evil: 1'));
  assert.throws(() => cleanUserAgentValue(42));
  assert.equal(isValidUserAgent('a'.repeat(513)), false);
  assert.equal(isValidUserAgent('Mozilla/5.0 ü'), false);
});

test('presets use the given Chromium major and are valid', () => {
  const presets = userAgentPresets(150);
  assert.ok(presets.every((preset) => isValidUserAgent(preset.value)));
  assert.ok(presets[0]!.value.includes('Chrome/150.0.0.0'));
  assert.equal(new Set(presets.map((preset) => preset.value)).size, presets.length);
});

test('randomize never returns the current value', () => {
  const presets = userAgentPresets(150);
  for (const r of [0, 0.5, 0.9999]) assert.notEqual(randomUserAgent(presets, presets[0]!.value, () => r), presets[0]!.value);
  assert.equal(randomUserAgent([], 'x'), 'x');
});
