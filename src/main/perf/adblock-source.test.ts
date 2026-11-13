import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestSourceUrl, withRequestSource } from './adblock-source';

const tab = { getURL: () => 'https://page.example/' };
const destroyed = {
  get url(): string {
    throw new Error('Render frame was disposed');
  },
};

test('a present referrer is used unchanged and details are not copied', () => {
  const details = { referrer: 'https://ref.example/', resourceType: 'script', frame: { url: 'https://frame.example/' }, webContents: tab };
  assert.equal(requestSourceUrl(details), 'https://ref.example/');
  assert.equal(withRequestSource(details), details);
});

test('empty referrer falls back to the requesting frame', () => {
  const details = { referrer: '', resourceType: 'xhr', frame: { url: 'https://frame.example/a' }, webContents: tab };
  assert.equal(requestSourceUrl(details), 'https://frame.example/a');
  const filled = withRequestSource(details);
  assert.notEqual(filled, details);
  assert.equal(filled.referrer, 'https://frame.example/a');
  assert.equal(details.referrer, '', 'original details are not mutated');
});

test('empty referrer without a frame falls back to the webContents URL', () => {
  assert.equal(requestSourceUrl({ referrer: '', resourceType: 'image', frame: null, webContents: tab }), 'https://page.example/');
});

test('main-frame navigations keep an empty source', () => {
  const details = { referrer: '', resourceType: 'mainFrame', frame: { url: 'https://frame.example/' }, webContents: tab };
  assert.equal(requestSourceUrl(details), '');
  assert.equal(withRequestSource(details), details);
});

test('a subframe navigation uses its parent document', () => {
  const details = { referrer: '', resourceType: 'subFrame', frame: { url: 'about:blank', parent: { url: 'https://parent.example/' } }, webContents: tab };
  assert.equal(requestSourceUrl(details), 'https://parent.example/');
});

test('a destroyed frame falls back to the webContents URL', () => {
  assert.equal(requestSourceUrl({ referrer: '', resourceType: 'script', frame: destroyed, webContents: tab }), 'https://page.example/');
});

test('non-web URLs and everything destroyed leave the source empty', () => {
  const gone = { getURL: (): string => { throw new Error('Object has been destroyed'); } };
  const details = { referrer: '', resourceType: 'script', frame: { url: 'about:blank' }, webContents: gone };
  assert.equal(requestSourceUrl(details), '');
  assert.equal(withRequestSource(details), details);
});
