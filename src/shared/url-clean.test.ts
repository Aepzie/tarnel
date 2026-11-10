import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanUrl, isTrackingParam } from './url-clean';

test('removes global click ids and utm_*, keeps everything else byte for byte', () => {
  const result = cleanUrl('https://example.com/a/b?id=7&utm_source=news&utm_Medium=mail&q=a%20b+c&fbclid=XYZ#top');
  assert.equal(result.url, 'https://example.com/a/b?id=7&q=a%20b+c#top');
  assert.deepEqual(result.removed, ['utm_source', 'utm_medium', 'fbclid']);
});

test('drops the "?" when every parameter was tracking', () => {
  assert.equal(cleanUrl('https://example.com/?gclid=1&msclkid=2').url, 'https://example.com/');
  assert.equal(cleanUrl('https://example.com/p?mc_eid=1#frag').url, 'https://example.com/p#frag');
});

test('unchanged URLs are returned as-is (no redirect loop)', () => {
  for (const url of [
    'https://example.com/',
    'https://example.com/?q=utm_source',
    'https://example.com/#?utm_source=x',
    'http://localhost:3000/?page=2&&sort=asc',
    'vela://newtab/?utm_source=x',
    'not a url',
  ]) {
    const result = cleanUrl(url);
    assert.equal(result.url, url);
    assert.deepEqual(result.removed, []);
  }
});

test('idempotent', () => {
  const once = cleanUrl('https://shop.example/?a=1&utm_campaign=x&oly_enc_id=2&vero_id=3&_hsenc=4&mkt_tok=5&b=2').url;
  assert.equal(once, 'https://shop.example/?a=1&b=2');
  assert.equal(cleanUrl(once).url, once);
});

test('site-specific rules only apply on their site', () => {
  assert.equal(cleanUrl('https://open.spotify.com/track/1?si=abc').url, 'https://open.spotify.com/track/1');
  assert.equal(cleanUrl('https://www.youtube.com/watch?v=dQw&si=abc&pp=x').url, 'https://www.youtube.com/watch?v=dQw');
  assert.equal(cleanUrl('https://youtu.be/dQw?si=abc&t=42').url, 'https://youtu.be/dQw?t=42');
  assert.equal(cleanUrl('https://x.com/user/status/1?s=20&t=abc').url, 'https://x.com/user/status/1');
  assert.equal(cleanUrl('https://twitter.com/user?ref_src=twsrc%5Etfw').url, 'https://twitter.com/user');
  assert.equal(cleanUrl('https://example.com/?si=keep&s=keep&t=keep&ref_src=keep').url, 'https://example.com/?si=keep&s=keep&t=keep&ref_src=keep');
});

test('Amazon: recommendation tracking removed, affiliate tag kept', () => {
  assert.equal(
    cleanUrl('https://www.amazon.de/dp/B0?tag=creator-21&pd_rd_r=1&pf_rd_p=2&th=1').url,
    'https://www.amazon.de/dp/B0?tag=creator-21&th=1',
  );
});

test('encoded parameter names are matched', () => {
  assert.equal(cleanUrl('https://example.com/?%75tm_source=x&a=1').url, 'https://example.com/?a=1');
  assert.equal(isTrackingParam('GCLID', 'example.com'), true);
  assert.equal(isTrackingParam('ref', 'example.com'), false);
  assert.equal(isTrackingParam('tag', 'amazon.com'), false);
});
