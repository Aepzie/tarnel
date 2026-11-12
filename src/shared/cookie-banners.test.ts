import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanExceptions, isExcepted, parseDoneReport, siteKeyOf } from './cookie-banners';

test('siteKeyOf normalises URLs and hosts', () => {
  assert.equal(siteKeyOf('https://www.Spiegel.de/politik/'), 'spiegel.de');
  assert.equal(siteKeyOf('news.example.com'), 'news.example.com');
  assert.equal(siteKeyOf('www.example.com.'), 'example.com');
  assert.equal(siteKeyOf('tarnel://settings'), null);
  assert.equal(siteKeyOf('file:///C:/x'), null);
  assert.equal(siteKeyOf(''), null);
  assert.equal(siteKeyOf('bad host'), null);
});

test('isExcepted matches the site and its subdomains only', () => {
  const list = ['example.com'];
  assert.equal(isExcepted('example.com', list), true);
  assert.equal(isExcepted('www.example.com', list), true);
  assert.equal(isExcepted('shop.example.com', list), true);
  assert.equal(isExcepted('notexample.com', list), false);
  assert.equal(isExcepted('example.com.evil.net', list), false);
});

test('cleanExceptions drops junk and de-duplicates', () => {
  assert.deepEqual(cleanExceptions(['b.com', 'www.b.com', 'A.com', 42, 'x y', null]), ['a.com', 'b.com']);
  assert.deepEqual(cleanExceptions('nope'), []);
});

test('parseDoneReport validates', () => {
  assert.deepEqual(parseDoneReport({ cmp: 'Onetrust', cosmetic: false }), { cmp: 'Onetrust', cosmetic: false });
  assert.deepEqual(parseDoneReport({ cmp: 'x', cosmetic: 'yes' }), { cmp: 'x', cosmetic: false });
  assert.equal(parseDoneReport({ cmp: '' }), null);
  assert.equal(parseDoneReport(null), null);
});
