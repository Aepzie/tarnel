import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG_CATEGORIES, EXTENSION_CATALOG, filterCatalog, installHashId, storeDetailId, storeSearchUrl } from './extension-catalog';

test('catalog IDs are unique 32-letter store IDs in known categories', () => {
  const categories = new Set(CATALOG_CATEGORIES.map((category) => category.id));
  const ids = new Set<string>();
  for (const entry of EXTENSION_CATALOG) {
    assert.match(entry.id, /^[a-p]{32}$/, entry.name);
    assert.ok(categories.has(entry.category), entry.name);
    assert.ok(!ids.has(entry.id), `duplicate ${entry.id}`);
    ids.add(entry.id);
  }
});

test('storeDetailId reads detail pages only', () => {
  const id = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';
  assert.equal(storeDetailId(`https://chromewebstore.google.com/detail/dark-reader/${id}`), id);
  assert.equal(storeDetailId(`https://chromewebstore.google.com/detail/dark-reader/${id}?hl=en`), id);
  assert.equal(storeDetailId(`https://chromewebstore.google.com/detail/${id}`), id);
  assert.equal(storeDetailId('https://chromewebstore.google.com/search/dark'), null);
  assert.equal(storeDetailId(`http://chromewebstore.google.com/detail/x/${id}`), null);
  assert.equal(storeDetailId(`https://evil.example/detail/x/${id}`), null);
});

test('search url and filtering', () => {
  assert.equal(storeSearchUrl('dark mode'), 'https://chromewebstore.google.com/search/dark%20mode');
  assert.equal(storeSearchUrl('  '), 'https://chromewebstore.google.com/');
  assert.ok(filterCatalog(EXTENSION_CATALOG, 'password').some((entry) => entry.name === 'Bitwarden'));
  assert.equal(filterCatalog(EXTENSION_CATALOG, '').length, EXTENSION_CATALOG.length);
  assert.equal(filterCatalog(EXTENSION_CATALOG, 'zzzz-nothing').length, 0);
});

test('install hash', () => {
  assert.equal(installHashId('#install=eimadpbcbfnmbkopoojfekhnkhdbieeh'), 'eimadpbcbfnmbkopoojfekhnkhdbieeh');
  assert.equal(installHashId('#install=nope'), null);
  assert.equal(installHashId(''), null);
});
