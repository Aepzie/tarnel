import assert from 'node:assert/strict';
import { test } from 'node:test';
import { denyEncryptedMedia } from './headers';
test('denying encrypted media preserves unrelated policies and cannot be overridden by duplicate headers', () => {
  const headers = denyEncryptedMedia({ 'Permissions-Policy': ['camera=(), encrypted-media=*'], 'permissions-policy': ['geolocation=(self), encrypted-media=(self)'], 'Content-Security-Policy': ["default-src 'self'"] });
  assert.deepEqual(headers, { 'Permissions-Policy': ['camera=(), geolocation=(self), encrypted-media=()'], 'Content-Security-Policy': ["default-src 'self'"] });
  assert.deepEqual(denyEncryptedMedia(undefined), { 'Permissions-Policy': ['encrypted-media=()'] });
});

test('malformed structured headers cannot invalidate the encrypted-media denial', () => {
  for (const value of ['camera=(', 'camera="unterminated', 'camera=();report-to="bad\\escape"', 'camera=(),', 'camera=(self,,)', 'camera=?2', 'camera=1234567890123456']) {
    assert.deepEqual(denyEncryptedMedia({ 'Permissions-Policy': [value] }), { 'Permissions-Policy': ['encrypted-media=()'] }, value);
  }
});

test('quoted commas, escaped quotes and parameters stay intact', () => {
  const value = 'camera=(self "https://example.com/a,encrypted-media=*");report-to="camera,errors", geolocation=();report-to="geo\\\"errors", encrypted-media=*;report-to="unused"';
  assert.deepEqual(denyEncryptedMedia({ 'Permissions-Policy': [value] }), {
    'Permissions-Policy': ['camera=(self "https://example.com/a,encrypted-media=*");report-to="camera,errors", geolocation=();report-to="geo\\\"errors", encrypted-media=()'],
  });
});

test('all duplicate encrypted-media dictionary members are removed including bare members', () => {
  assert.deepEqual(denyEncryptedMedia({ 'Permissions-Policy': ['encrypted-media, camera=(), encrypted-media;flag, encrypted-media=*'] }), {
    'Permissions-Policy': ['camera=(), encrypted-media=()'],
  });
});

test('an oversized merged dictionary must fail closed rather than be ignored by Chromium', () => {
  const valid = `camera=(), x="${'a'.repeat(65505)}"`;
  assert.throws(() => denyEncryptedMedia({ 'Permissions-Policy': [valid] }), RangeError);
  // Chromium already ignores an original larger than its parser limit.
  assert.deepEqual(denyEncryptedMedia({ 'Permissions-Policy': [`x="${'a'.repeat(65536)}"`] }), {
    'Permissions-Policy': ['encrypted-media=()'],
  });
});
