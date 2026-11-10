import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trimReferrer } from './referrer';

test('same-site: unchanged', () => {
  assert.equal(trimReferrer('https://www.example.com/a/b?q=1', 'https://cdn.example.com/x.js'), 'https://www.example.com/a/b?q=1');
  assert.equal(trimReferrer('https://bbc.co.uk/news/1', 'https://static.bbc.co.uk/x'), 'https://bbc.co.uk/news/1');
});

test('cross-site: origin only', () => {
  assert.equal(trimReferrer('https://www.example.com/secret/path?token=1', 'https://tracker.net/p'), 'https://www.example.com/');
  assert.equal(trimReferrer('http://a.test:8080/x', 'http://b.test/'), 'http://a.test:8080/');
  assert.equal(trimReferrer('https://a.co.uk/x', 'https://b.co.uk/'), 'https://a.co.uk/');
});

test('https -> http: dropped, even same-site', () => {
  assert.equal(trimReferrer('https://example.com/x', 'http://example.com/y'), null);
  assert.equal(trimReferrer('https://example.com/', 'http://other.net/'), null);
});

test('already trimmed or empty stays as is', () => {
  assert.equal(trimReferrer('https://example.com/', 'https://other.net/'), 'https://example.com/');
  assert.equal(trimReferrer('', 'https://other.net/'), '');
  assert.equal(trimReferrer('garbage', 'https://other.net/'), 'garbage');
});
