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
