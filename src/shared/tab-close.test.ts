import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLoneStartPage } from './tab-close';

const start = { id: 1, spaceId: 'a', url: 'vela://newtab/' };
const site = { id: 2, spaceId: 'a', url: 'https://example.com/' };

test('lone start page in its space is not closable', () => {
  assert.equal(isLoneStartPage(start, [start]), true);
  assert.equal(isLoneStartPage(start, [start, { id: 9, spaceId: 'b', url: 'https://x.dev/' }]), true);
});

test('start page with siblings in the same space is closable', () => {
  assert.equal(isLoneStartPage(start, [start, site]), false);
});

test('lone website tab stays closable', () => {
  assert.equal(isLoneStartPage(site, [site]), false);
});
