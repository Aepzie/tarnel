import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EarlyFrames, LruCache, scriptletPageUrl } from './adblock-early';

test('scriptletPageUrl keeps http(s) pages and drops fragment and credentials', () => {
  assert.equal(scriptletPageUrl('https://www.youtube.com/watch?v=abc#t=10'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(scriptletPageUrl('http://user:pw@example.com/a'), 'http://example.com/a');
  assert.equal(scriptletPageUrl('https://www.youtube-nocookie.com/embed/x'), 'https://www.youtube-nocookie.com/embed/x');
});

test('scriptletPageUrl rejects non-web, malformed and oversized input', () => {
  for (const raw of ['about:blank', 'tarnel://settings', 'file:///C:/x.html', 'data:text/html,x', 'not a url', '', 42, null, undefined, {}, `https://a.com/${'x'.repeat(9000)}`]) {
    assert.equal(scriptletPageUrl(raw), null, String(raw).slice(0, 40));
  }
});

test('EarlyFrames lets the late path skip exactly once per early-served document', () => {
  const frames = new EarlyFrames();
  frames.record(7, 1, true);
  assert.equal(frames.consume(7, 1), true);
  assert.equal(frames.consume(7, 1), false);
  assert.equal(frames.consume(8, 1), false);
});

test('EarlyFrames: a new document that was not served early clears the old mark', () => {
  const frames = new EarlyFrames();
  frames.record(7, 1, true);
  frames.record(7, 1, false);
  assert.equal(frames.consume(7, 1), false);
});

test('EarlyFrames stays bounded', () => {
  const frames = new EarlyFrames(3);
  for (let id = 1; id <= 5; id += 1) frames.record(1, id, true);
  assert.equal(frames.size, 3);
  assert.equal(frames.consume(1, 1), false);
  assert.equal(frames.consume(1, 5), true);
});

test('LruCache evicts the least recently used entry', () => {
  const cache = new LruCache<number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
  cache.clear();
  assert.equal(cache.size, 0);
});
