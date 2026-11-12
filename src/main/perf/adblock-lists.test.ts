import assert from 'node:assert/strict';
import test from 'node:test';
import { engineListSources, LIST_SET, listSetKey } from './adblock-lists';

const MIRROR = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets';

const UBO = 'https://ublockorigin.github.io/uAssets/filters';

test('mirrored uBO lists are fetched from uBO itself with the mirror as fallback; others are kept', () => {
  const sources = engineListSources([`${MIRROR}/easylist/easylist.txt`, `${MIRROR}/ublock-origin/quick-fixes.txt`, `${MIRROR}/ublock-origin/filters-2024.txt`]);
  assert.deepEqual(sources, [
    { url: `${MIRROR}/easylist/easylist.txt`, fallback: null },
    { url: `${UBO}/quick-fixes.txt`, fallback: `${MIRROR}/ublock-origin/quick-fixes.txt` },
    { url: `${UBO}/filters-2024.txt`, fallback: `${MIRROR}/ublock-origin/filters-2024.txt` },
    { url: `${UBO}/filters-2025.txt`, fallback: null },
    { url: `${UBO}/filters-2026.txt`, fallback: null },
  ]);
});

test('yearly lists already in the preset are not added twice', () => {
  const sources = engineListSources([`${MIRROR}/ublock-origin/filters-2025.txt`]);
  assert.equal(sources.filter((source) => source.url.endsWith('filters-2025.txt')).length, 1);
});

test('the bundled extra list is part of the cache key', () => {
  assert.notEqual(listSetKey('aaaa'), listSetKey('bbbb'));
  assert.ok(listSetKey('aaaa').startsWith(LIST_SET));
});
