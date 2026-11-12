import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheKey, decodeCache, encodeCache } from './adblock-cache';

const key = cacheKey({ engineVersion: 899, libraryVersion: '2.20.3', lists: 'ads-tracking' });

test('round-trips the engine bytes under the same key', () => {
  const engine = new Uint8Array([1, 2, 3, 0x0a, 4]);
  assert.deepEqual(decodeCache(key, encodeCache(key, engine)), engine);
});

test('a different library version, engine version or list set is a miss', () => {
  const file = encodeCache(key, new Uint8Array([9]));
  assert.equal(decodeCache(cacheKey({ engineVersion: 899, libraryVersion: '2.21.0', lists: 'ads-tracking' }), file), null);
  assert.equal(decodeCache(cacheKey({ engineVersion: 900, libraryVersion: '2.20.3', lists: 'ads-tracking' }), file), null);
  assert.equal(decodeCache(cacheKey({ engineVersion: 899, libraryVersion: '2.20.3', lists: 'full' }), file), null);
});

test('legacy headerless, truncated and empty files are misses', () => {
  assert.equal(decodeCache(key, new Uint8Array([0, 0, 3, 131, 7, 1])), null);
  assert.equal(decodeCache(key, encodeCache(key, new Uint8Array(0))), null);
  assert.equal(decodeCache(key, encodeCache(key, new Uint8Array([1])).subarray(0, 8)), null);
  assert.equal(decodeCache(key, new Uint8Array(0)), null);
});

test('decoded engine bytes start on an aligned offset whatever the key length', () => {
  for (const key of ['k', 'kk', 'kkk', 'kkkk', 'kkkkk']) {
    const body = decodeCache(key, encodeCache(key, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
    assert.ok(body);
    assert.equal(body.byteOffset % 8, 0);
    assert.deepEqual([...body], [1, 2, 3, 4, 5, 6, 7, 8]);
  }
});

test('the engine bytes follow an 8-byte aligned header, so decoding needs no copy', () => {
  for (const k of ['k', 'kk', 'kkk', 'kkkkkkkkk']) {
    const file = encodeCache(k, new Uint8Array([1]));
    assert.equal((file.length - 1) % 8, 0);
    assert.equal(decodeCache(k, file)?.buffer, file.buffer);
  }
});

test('a cache written without header padding still decodes', () => {
  const header = new TextEncoder().encode('VELA-ADB1 k\n');
  const file = new Uint8Array(header.length + 3);
  file.set(header, 0);
  file.set([7, 8, 9], header.length);
  assert.deepEqual([...(decodeCache('k', file) ?? [])], [7, 8, 9]);
});
