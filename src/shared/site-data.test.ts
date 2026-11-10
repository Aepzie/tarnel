import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanSiteDataPolicy,
  clearsOnExit,
  clearsOnLastTab,
  hostMatches,
  normalizeSitePattern,
  originVariants,
  siteOverride,
  type SiteDataPolicy,
} from './site-data';

const policy = (patch: Partial<SiteDataPolicy>): SiteDataPolicy => ({ clearOnExit: false, clearOnLastTab: false, sites: {}, ...patch });

test('normalizeSitePattern accepts hosts, URLs and wildcards', () => {
  assert.equal(normalizeSitePattern(' Example.COM '), 'example.com');
  assert.equal(normalizeSitePattern('https://mail.example.com/inbox?x=1'), 'mail.example.com');
  assert.equal(normalizeSitePattern('*.example.com'), 'example.com');
  assert.equal(normalizeSitePattern('example.com/path'), 'example.com');
  assert.equal(normalizeSitePattern('localhost:8080'), 'localhost');
  assert.equal(normalizeSitePattern(''), null);
  assert.equal(normalizeSitePattern('bad host'), null);
  assert.equal(normalizeSitePattern('ex_ample.com'), null);
});

test('hostMatches covers the domain and its subdomains only', () => {
  assert.ok(hostMatches('example.com', 'example.com'));
  assert.ok(hostMatches('www.example.com', 'example.com'));
  assert.ok(hostMatches('.example.com', 'example.com'));
  assert.ok(!hostMatches('notexample.com', 'example.com'));
  assert.ok(!hostMatches('example.com.evil.net', 'example.com'));
  assert.ok(!hostMatches('example.com', 'www.example.com'));
});

test('the most specific override wins', () => {
  const p = policy({ sites: { 'example.com': 'keep', 'ads.example.com': 'clear' } });
  assert.equal(siteOverride(p, 'www.example.com'), 'keep');
  assert.equal(siteOverride(p, 'x.ads.example.com'), 'clear');
  assert.equal(siteOverride(p, 'other.org'), undefined);
});

test('clearsOnExit follows the Space default unless overridden', () => {
  const on = policy({ clearOnExit: true, sites: { 'keep.me': 'keep' } });
  assert.ok(clearsOnExit(on, 'random.site'));
  assert.ok(!clearsOnExit(on, 'login.keep.me'));
  const off = policy({ sites: { 'tracker.net': 'clear' } });
  assert.ok(!clearsOnExit(off, 'random.site'));
  assert.ok(clearsOnExit(off, 'cdn.tracker.net'));
});

test('clearsOnLastTab never touches kept sites', () => {
  const p = policy({ clearOnLastTab: true, sites: { 'keep.me': 'keep', 'gone.net': 'clear' } });
  assert.ok(clearsOnLastTab(p, 'a.example'));
  assert.ok(clearsOnLastTab(p, 'gone.net'));
  assert.ok(!clearsOnLastTab(p, 'keep.me'));
  assert.ok(!clearsOnLastTab(policy({}), 'a.example'));
});

test('originVariants pairs the bare and www hosts', () => {
  assert.deepEqual(originVariants('example.com'), ['https://example.com', 'http://example.com', 'https://www.example.com', 'http://www.example.com']);
  assert.deepEqual(originVariants('www.example.com').slice(2), ['https://example.com', 'http://example.com']);
});

test('cleanSiteDataPolicy drops junk', () => {
  assert.deepEqual(cleanSiteDataPolicy(null), { clearOnExit: false, clearOnLastTab: false, sites: {} });
  assert.deepEqual(
    cleanSiteDataPolicy({ clearOnExit: true, clearOnLastTab: 'yes', sites: { 'A.com': 'keep', 'b c': 'keep', 'd.com': 'maybe' } }),
    { clearOnExit: true, clearOnLastTab: false, sites: { 'a.com': 'keep' } },
  );
});
