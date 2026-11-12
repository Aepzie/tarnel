import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanSiteRules,
  hostOfUrl,
  normalizeSitePattern,
  patternMatches,
  patternSpecificity,
  resolveSiteRules,
  rulesTouchFingerprint,
  suggestPattern,
  type SiteRule,
} from './site-rules';

const rule = (id: string, pattern: string, actions: SiteRule['actions'], enabled = true): SiteRule => ({ id, pattern, enabled, actions });

test('patterns: normalized, pasted URLs reduced to the host, junk rejected', () => {
  assert.equal(normalizeSitePattern(' *.Facebook.COM '), '*.facebook.com');
  assert.equal(normalizeSitePattern('https://www.example.com:8443/path?q#x'), 'www.example.com');
  assert.equal(normalizeSitePattern('example.com.'), 'example.com');
  assert.equal(normalizeSitePattern('shop-**.example.*'), 'shop-*.example.*');
  assert.equal(normalizeSitePattern('*'), null);
  assert.equal(normalizeSitePattern('a..b'), null);
  assert.equal(normalizeSitePattern('ex ample.com'), null);
  assert.equal(normalizeSitePattern('(a|b).com'), null);
  assert.equal(normalizeSitePattern(42), null);
});

test('hosts: only http(s) URLs', () => {
  assert.equal(hostOfUrl('https://WWW.Example.com./a'), 'www.example.com');
  assert.equal(hostOfUrl('tarnel://settings'), null);
  assert.equal(hostOfUrl('file:///C:/x'), null);
  assert.equal(hostOfUrl('not a url'), null);
});

test('matching: exact, *.domain includes the apex, free wildcards span labels', () => {
  assert.ok(patternMatches('example.com', 'example.com'));
  assert.ok(!patternMatches('example.com', 'www.example.com'));
  assert.ok(patternMatches('*.example.com', 'example.com'));
  assert.ok(patternMatches('*.example.com', 'a.b.example.com'));
  assert.ok(!patternMatches('*.example.com', 'badexample.com'));
  assert.ok(patternMatches('shop-*.example.*', 'shop-eu.example.de'));
  assert.ok(!patternMatches('shop-*.example.*', 'shop.example.de'));
  assert.ok(patternMatches('example.*', 'example.co.uk'));
});

test('specificity: exact > *.domain > wildcard, longer first', () => {
  assert.ok(patternSpecificity('mail.google.com') > patternSpecificity('*.mail.google.com'));
  assert.ok(patternSpecificity('*.mail.google.com') > patternSpecificity('*.google.com'));
  assert.ok(patternSpecificity('*.google.com') > patternSpecificity('google.*'));
});

test('resolution: most specific rule wins per action kind, disabled rules ignored', () => {
  const rules = [
    rule('a', '*.google.com', [{ kind: 'vpn', country: 'de' }, { kind: 'space', spaceId: 'personal' }]),
    rule('b', 'mail.google.com', [{ kind: 'space', spaceId: 'work' }]),
    rule('c', 'mail.google.com', [{ kind: 'block' }], false),
  ];
  const result = resolveSiteRules(rules, 'https://mail.google.com/inbox');
  assert.deepEqual(result.matched.map((entry) => entry.id), ['b', 'a']);
  assert.equal(result.space, 'work');
  assert.equal(result.vpn, 'de');
  assert.equal(result.block, false);
  assert.equal(resolveSiteRules(rules, 'https://www.google.com').space, 'personal');
  assert.equal(resolveSiteRules(rules, 'tarnel://newtab').matched.length, 0);
});

test('resolution: equal specificity keeps list order', () => {
  const rules = [rule('a', '*.x.com', [{ kind: 'fingerprint', level: 'strict' }]), rule('b', '*.x.com', [{ kind: 'fingerprint', level: 'off' }])];
  assert.equal(resolveSiteRules(rules, 'https://x.com').fingerprint, 'strict');
});

test('cleaning: strict for renderer input, lenient for the stored file', () => {
  const good = [{ id: 'r1', pattern: '*.Example.com', enabled: true, actions: [{ kind: 'vpn', country: 'NL' }, { kind: 'vpn', country: 'de' }] }];
  assert.deepEqual(cleanSiteRules(good), [{ id: 'r1', pattern: '*.example.com', enabled: true, actions: [{ kind: 'vpn', country: 'nl' }] }]);
  assert.throws(() => cleanSiteRules([{ id: 'r1', pattern: '*', actions: [] }]));
  assert.throws(() => cleanSiteRules([{ id: 'r1', pattern: 'a.com', actions: [{ kind: 'userAgent', value: 'bad\nua' }] }]));
  assert.throws(() => cleanSiteRules([...good, ...good]));
  assert.throws(() => cleanSiteRules('nope'));
  assert.deepEqual(cleanSiteRules([{ id: 'bad id', pattern: 'a.com', actions: [] }, ...good], true).length, 1);
  assert.deepEqual(cleanSiteRules(null, true), []);
});

test('fingerprint preload is only needed for non-off fingerprint actions', () => {
  assert.ok(!rulesTouchFingerprint([rule('a', 'a.com', [{ kind: 'fingerprint', level: 'off' }])]));
  assert.ok(!rulesTouchFingerprint([rule('a', 'a.com', [{ kind: 'fingerprint', level: 'random' }], false)]));
  assert.ok(rulesTouchFingerprint([rule('a', 'a.com', [{ kind: 'fingerprint', level: 'random' }])]));
});

test('suggested pattern for the tab context menu', () => {
  assert.equal(suggestPattern('https://www.facebook.com/x'), '*.facebook.com');
  assert.equal(suggestPattern('http://127.0.0.1:8080/'), '127.0.0.1');
  assert.equal(suggestPattern('http://localhost/'), 'localhost');
  assert.equal(suggestPattern('tarnel://newtab'), null);
});
