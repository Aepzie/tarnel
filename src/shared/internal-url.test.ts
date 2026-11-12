import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalInternalUrl, isInternalUrl, isLegacyInternalUrl } from './internal-url';

test('tarnel:// and the legacy vela:// alias are internal', () => {
  assert.equal(isInternalUrl('tarnel://settings/'), true);
  assert.equal(isInternalUrl('TARNEL://newtab'), true);
  assert.equal(isInternalUrl('vela://history/'), true);
  assert.equal(isInternalUrl('https://tarnel.example/'), false);
  assert.equal(isInternalUrl('velar://x'), false);
});

test('legacy vela URLs map to the same tarnel page', () => {
  assert.equal(canonicalInternalUrl('vela://settings/#rules'), 'tarnel://settings/#rules');
  assert.equal(canonicalInternalUrl('VELA://newtab/?q=1'), 'tarnel://newtab/?q=1');
  assert.equal(canonicalInternalUrl('vela:settings'), 'tarnel:settings');
  assert.equal(isLegacyInternalUrl('vela://bookmarks/'), true);
  assert.equal(isLegacyInternalUrl('tarnel://bookmarks/'), false);
});

test('other URLs are left alone', () => {
  for (const url of ['tarnel://privacy', 'https://vela.example/', 'file:///C:/vela.html', '', 'velaxyz://a']) {
    assert.equal(canonicalInternalUrl(url), url);
  }
});
