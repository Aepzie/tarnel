import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateBeforeRequest, evaluateHeaders, type ExtensionRules } from './matcher';
import { compileUrlFilter, regexTokens, translateRegex } from './pattern';
import { createRequestInfo, type RequestInput } from './request';
import { compileRule, RuleError } from './rule';
import { buildRuleset, mergeRulesets, requestKeys } from './ruleset';
import type { ResourceType, Rule } from './types';

const EXT_A = 'a'.repeat(32);
const EXT_B = 'b'.repeat(32);

function extension(id: string, rules: unknown[], options: Partial<ExtensionRules> & { session?: unknown[] } = {}): ExtensionRules {
  const indexes = [buildRuleset('static', 'static', rules, false).index];
  if (options.session) indexes.push(buildRuleset('_session', 'session', options.session, true).index);
  return {
    extensionId: id,
    installRank: options.installRank ?? 1,
    indexes,
    permission: options.permission ?? 'all',
    hasHostAccess: options.hasHostAccess ?? (() => true),
  };
}

function request(url: string, type: ResourceType = 'script', extra: Partial<RequestInput> = {}) {
  const info = createRequestInfo({ url, type, initiator: 'https://page.example', tabId: 1, ...extra });
  assert.ok(info, `request for ${url}`);
  return info;
}

function outcome(extensions: ExtensionRules[], url: string, type: ResourceType = 'script', extra: Partial<RequestInput> = {}) {
  return evaluateBeforeRequest(extensions, request(url, type, extra), extra.initiator ?? 'https://page.example').outcome;
}

function matches(filter: string, url: string, caseSensitive = false): boolean {
  return compileUrlFilter(filter, caseSensitive).test(url, url.toLowerCase());
}

const block = (id: number, condition: Rule['condition'], priority = 1): Rule => ({ id, priority, action: { type: 'block' }, condition });

describe('urlFilter', () => {
  it('handles the domain anchor', () => {
    assert.equal(matches('||ads.com^', 'https://ads.com/x'), true);
    assert.equal(matches('||ads.com^', 'https://cdn.ads.com/x'), true);
    assert.equal(matches('||ads.com^', 'https://badads.com/x'), false);
    assert.equal(matches('||ads.com^', 'https://ads.com.evil.org/x'), false);
    assert.equal(matches('||ads.com^', 'https://ads.com:8080/x'), true);
    assert.equal(matches('||ads.com^', 'https://example.org/?u=https://ads.com/'), false);
    assert.equal(matches('||ads.com', 'https://ads.community/x'), true);
  });

  it('handles start / end anchors, wildcards and separators', () => {
    assert.equal(matches('|https://a.com/', 'https://a.com/x'), true);
    assert.equal(matches('|https://a.com/', 'http://b.com/?https://a.com/'), false);
    assert.equal(matches('.js|', 'https://a.com/x.js'), true);
    assert.equal(matches('.js|', 'https://a.com/x.js?v=1'), false);
    assert.equal(matches('/ads/*/banner', 'https://a.com/ads/123/banner.png'), true);
    assert.equal(matches('/ads^', 'https://a.com/ads?x'), true);
    assert.equal(matches('/ads^', 'https://a.com/ads'), true);
    assert.equal(matches('/ads^', 'https://a.com/adserver'), false);
    assert.equal(matches('/ads^', 'https://a.com/ads.js'), false);
  });

  it('is case-insensitive unless asked otherwise', () => {
    assert.equal(matches('/Banner', 'https://a.com/banner'), true);
    assert.equal(matches('/Banner', 'https://a.com/banner', true), false);
    assert.equal(matches('/Banner', 'https://a.com/Banner', true), true);
  });

  it('extracts only tokens pinned on both sides', () => {
    assert.deepEqual(compileUrlFilter('||ads.example.com^', false).tokens, ['ads', 'example', 'com']);
    assert.deepEqual(compileUrlFilter('ads/banner', false).tokens, []);
    assert.deepEqual(compileUrlFilter('/ads/banner*', false).tokens, ['ads']);
    assert.equal(compileUrlFilter('||ads.example.com^', false).host, 'ads.example.com');
    assert.equal(compileUrlFilter('||ads.example.com^', false).hostOnly, true);
    assert.equal(compileUrlFilter('||ads.example.com/x', false).hostOnly, false);
    assert.equal(compileUrlFilter('||ads.example', false).host, null);
  });
});

describe('regexFilter', () => {
  it('translates RE2 and rejects what RE2 lacks', () => {
    assert.ok(!('problem' in translateRegex('^https?://[^/]+/ads/')));
    assert.deepEqual(translateRegex('a(?=b)'), { problem: 'syntaxError' });
    assert.deepEqual(translateRegex('(a)\\1'), { problem: 'syntaxError' });
    assert.deepEqual(translateRegex('a{1001}'), { problem: 'memoryLimitExceeded' });
    assert.deepEqual(translateRegex('(?P<x>a)'), { source: '(?<x>a)', flags: '' });
    assert.deepEqual(translateRegex('(?i)abc'), { source: 'abc', flags: 'i' });
    assert.deepEqual(translateRegex('[[:digit:]]+'), { source: '[0-9]+', flags: '' });
    assert.deepEqual(translateRegex('[unclosed'), { problem: 'syntaxError' });
  });

  it('finds bounded literal tokens', () => {
    assert.deepEqual(regexTokens('^https?:\\/\\/[^/]+\\/ads\\/[0-9]+\\.js'), ['ads']);
    assert.deepEqual(regexTokens('\\/ads?\\/'), []);
    assert.deepEqual(regexTokens('\\/(ads|track)\\/'), []);
    assert.deepEqual(regexTokens('\\.example\\.com\\/'), ['example', 'com']);
  });
});

describe('rule validation', () => {
  const compile = (rule: unknown) => compileRule(rule, { kind: 'dynamic', rulesetId: '_dynamic', keepSource: false });

  it('accepts valid rules', () => {
    assert.equal(compile(block(1, { urlFilter: '||a.com^' })).type, 'block');
    assert.equal(compile({ id: 2, action: { type: 'allowAllRequests' }, condition: { resourceTypes: ['main_frame'] } }).type, 'allowAllRequests');
  });

  it('rejects invalid rules with Chrome-like messages', () => {
    assert.throws(() => compile({ id: 0, action: { type: 'block' }, condition: {} }), RuleError);
    assert.throws(() => compile({ id: 1, action: { type: 'nope' }, condition: {} }), /valid action type/);
    assert.throws(() => compile(block(1, { urlFilter: 'a', regexFilter: 'b' })), /both urlFilter and regexFilter/);
    assert.throws(() => compile(block(1, { urlFilter: 'a|b' })), /urlFilter/);
    assert.throws(() => compile(block(1, { resourceTypes: [] })), /empty "resourceTypes"/);
    assert.throws(() => compile({ id: 1, action: { type: 'allowAllRequests' }, condition: { resourceTypes: ['script'] } }), /allowAllRequests/);
    assert.throws(() => compile(block(1, { tabIds: [1] })), /session-scoped/);
    assert.throws(() => compile({ id: 1, action: { type: 'redirect' }, condition: {} }), /redirect/);
    assert.throws(
      () => compile({ id: 1, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'x-foo', operation: 'append', value: '1' }] }, condition: {} }),
      /appended/,
    );
    assert.throws(() => compile(block(1, { regexFilter: '(?<=a)b' })), /invalid regex/);
  });
});

describe('conditions', () => {
  it('does not match main_frame unless asked to', () => {
    const ext = extension(EXT_A, [block(1, { urlFilter: '||a.com^' })]);
    assert.equal(outcome([ext], 'https://a.com/', 'main_frame')?.kind, undefined);
    assert.equal(outcome([ext], 'https://a.com/x.js', 'script')?.kind, 'block');
    const frames = extension(EXT_A, [block(1, { urlFilter: '||a.com^', resourceTypes: ['main_frame'] })]);
    assert.equal(outcome([frames], 'https://a.com/', 'main_frame')?.kind, 'block');
  });

  it('matches request / initiator domains, party and methods', () => {
    const ext = extension(EXT_A, [
      block(1, { requestDomains: ['tracker.net'], excludedRequestDomains: ['ok.tracker.net'] }),
      block(2, { urlFilter: '/pixel', initiatorDomains: ['news.com'], excludedInitiatorDomains: ['sports.news.com'] }),
      block(3, { urlFilter: '/3p.js', domainType: 'thirdParty' }),
      block(4, { urlFilter: '/post-only', requestMethods: ['post'] }),
    ]);
    assert.equal(outcome([ext], 'https://cdn.tracker.net/x')?.kind, 'block');
    assert.equal(outcome([ext], 'https://ok.tracker.net/x'), null);
    assert.equal(outcome([ext], 'https://img.com/pixel', 'image', { initiator: 'https://www.news.com' })?.kind, 'block');
    assert.equal(outcome([ext], 'https://img.com/pixel', 'image', { initiator: 'https://sports.news.com' }), null);
    assert.equal(outcome([ext], 'https://img.com/pixel', 'image', { initiator: null }), null);
    assert.equal(outcome([ext], 'https://cdn.other.com/3p.js', 'script', { initiator: 'https://site.com' })?.kind, 'block');
    assert.equal(outcome([ext], 'https://cdn.site.com/3p.js', 'script', { initiator: 'https://www.site.com' }), null);
    assert.equal(outcome([ext], 'https://a.com/post-only', 'xmlhttprequest', { method: 'POST' })?.kind, 'block');
    assert.equal(outcome([ext], 'https://a.com/post-only', 'xmlhttprequest', { method: 'GET' }), null);
  });

  it('honours session tabIds (TAB_ID_NONE = -1)', () => {
    const ext = extension(EXT_A, [block(1, { urlFilter: '/x.js' })], {
      session: [{ id: 9, priority: 5, action: { type: 'allow' }, condition: { tabIds: [-1] } }],
    });
    assert.equal(outcome([ext], 'https://a.com/x.js', 'script', { tabId: 3 })?.kind, 'block');
    assert.equal(outcome([ext], 'https://a.com/x.js', 'script', { tabId: -1 })?.kind, 'allow');
  });
});

describe('precedence', () => {
  it('within one extension: priority, then allow > allowAllRequests > block > upgradeScheme > redirect', () => {
    const rules: Rule[] = [
      block(1, { urlFilter: '||a.com^' }, 1),
      { id: 2, priority: 1, action: { type: 'allow' }, condition: { urlFilter: '||a.com^' } },
      { id: 3, priority: 2, action: { type: 'redirect', redirect: { url: 'https://b.com/' } }, condition: { urlFilter: '||a.com^' } },
    ];
    assert.equal(outcome([extension(EXT_A, rules)], 'https://a.com/x')?.kind, 'redirect');
    assert.equal(outcome([extension(EXT_A, rules.slice(0, 2))], 'https://a.com/x')?.kind, 'allow');
    const upgrade: Rule[] = [
      { id: 1, action: { type: 'upgradeScheme' }, condition: { urlFilter: '||a.com^' } },
      { id: 2, action: { type: 'redirect', redirect: { url: 'https://b.com/' } }, condition: { urlFilter: '||a.com^' } },
    ];
    const result = outcome([extension(EXT_A, upgrade)], 'http://a.com/x');
    assert.equal(result?.kind === 'redirect' && result.url, 'https://a.com/x');
    assert.equal(outcome([extension(EXT_A, upgrade.slice(0, 1))], 'https://a.com/x'), null);
  });

  it('across extensions: block > redirect > allow, ties to the most recently installed', () => {
    const allowA = extension(EXT_A, [{ id: 1, priority: 9, action: { type: 'allow' }, condition: { urlFilter: '||a.com^' } }], { installRank: 2 });
    const blockB = extension(EXT_B, [block(1, { urlFilter: '||a.com^' })], { installRank: 1 });
    assert.equal(outcome([allowA, blockB], 'https://a.com/x')?.kind, 'block');
    const redirectA = extension(EXT_A, [{ id: 1, action: { type: 'redirect', redirect: { url: 'https://one.com/' } }, condition: { urlFilter: '||a.com^' } }], { installRank: 1 });
    const redirectB = extension(EXT_B, [{ id: 1, action: { type: 'redirect', redirect: { url: 'https://two.com/' } }, condition: { urlFilter: '||a.com^' } }], { installRank: 2 });
    const result = outcome([redirectA, redirectB], 'https://a.com/x');
    assert.equal(result?.kind === 'redirect' && result.url, 'https://two.com/');
  });

  it('applies a frame allowAllRequests like an allow rule of that priority', () => {
    const ext = extension(EXT_A, [
      { id: 1, priority: 10, action: { type: 'allowAllRequests' }, condition: { requestDomains: ['trusted.com'], resourceTypes: ['main_frame'] } },
      block(2, { urlFilter: '/ad.js' }, 5),
      block(3, { urlFilter: '/evil.js' }, 20),
    ]);
    const frame = evaluateBeforeRequest([ext], request('https://trusted.com/', 'main_frame', { initiator: null }), null);
    assert.equal(frame.outcome?.kind, 'allow');
    assert.equal(frame.allowAll.get(EXT_A), 10);
    const allowance = (id: string): number => frame.allowAll.get(id) ?? 0;
    const sub = (url: string) => evaluateBeforeRequest([ext], request(url, 'script', { initiator: 'https://trusted.com' }), 'https://trusted.com', allowance).outcome;
    assert.equal(sub('https://cdn.com/ad.js'), null);
    assert.equal(sub('https://cdn.com/evil.js')?.kind, 'block');
  });

  it('skips redirect / modifyHeaders without host access (declarativeNetRequest)', () => {
    const rules: Rule[] = [
      block(1, { urlFilter: '/block' }),
      { id: 2, action: { type: 'redirect', redirect: { url: 'https://b.com/' } }, condition: { urlFilter: '/redirect' } },
    ];
    const noHosts = extension(EXT_A, rules, { hasHostAccess: () => false });
    assert.equal(outcome([noHosts], 'https://a.com/block')?.kind, 'block');
    assert.equal(outcome([noHosts], 'https://a.com/redirect'), null);
    const hostOnly = extension(EXT_A, rules, { permission: 'host', hasHostAccess: () => false });
    assert.equal(outcome([hostOnly], 'https://a.com/block'), null);
  });
});

describe('redirects', () => {
  const redirectTo = (redirect: object, url: string, condition: Rule['condition'] = { urlFilter: '||a.com^' }) => {
    const result = outcome([extension(EXT_A, [{ id: 1, action: { type: 'redirect', redirect }, condition }])], url);
    return result?.kind === 'redirect' ? result.url : null;
  };

  it('supports url, extensionPath and transforms', () => {
    assert.equal(redirectTo({ extensionPath: '/noop.js' }, 'https://a.com/x.js'), `chrome-extension://${EXT_A}/noop.js`);
    assert.equal(redirectTo({ transform: { queryTransform: { removeParams: ['utm_source', 'fbclid'] } } }, 'https://a.com/p?utm_source=x&id=1&fbclid=2#top'), 'https://a.com/p?id=1#top');
    assert.equal(redirectTo({ transform: { queryTransform: { removeParams: ['utm_source'] } } }, 'https://a.com/p?id=1'), null);
    assert.equal(redirectTo({ transform: { queryTransform: { addOrReplaceParams: [{ key: 'a', value: '2' }, { key: 'b', value: '3', replaceOnly: true }] } } }, 'https://a.com/?a=1'), 'https://a.com/?a=2');
    assert.equal(redirectTo({ transform: { host: 'b.com', path: '/new', fragment: '#f' } }, 'https://a.com/old?q'), 'https://b.com/new?q#f');
    assert.equal(redirectTo({ transform: { scheme: 'https' } }, 'http://a.com:80/x'), 'https://a.com/x');
  });

  it('supports regexSubstitution', () => {
    assert.equal(
      redirectTo({ regexSubstitution: 'https://\\1.xyz.com/' }, 'https://www.abc.xyz.com/path', { regexFilter: '^https://www\\.(abc|def)\\.xyz\\.com/' }),
      'https://abc.xyz.com/path',
    );
  });
});

describe('modifyHeaders', () => {
  it('applies request and response operations with conflict rules', () => {
    const a = extension(EXT_A, [
      { id: 1, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'user-agent', operation: 'set', value: 'A' }, { header: 'referer', operation: 'remove' }] }, condition: { urlFilter: '||a.com^' } },
      { id: 2, action: { type: 'modifyHeaders', responseHeaders: [{ header: 'content-security-policy', operation: 'append', value: "worker-src 'none'" }] }, condition: { urlFilter: '||a.com^' } },
    ], { installRank: 2 });
    const b = extension(EXT_B, [
      { id: 1, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'user-agent', operation: 'set', value: 'B' }] }, condition: { urlFilter: '||a.com^' } },
    ], { installRank: 1 });
    const headers: Record<string, string> = { 'User-Agent': 'orig', Referer: 'https://x/' };
    evaluateHeaders([a, b], request('https://a.com/x'), null, { kind: 'request', headers });
    assert.deepEqual(headers, { 'User-Agent': 'A' });
    const response: Record<string, string[]> = { 'Content-Security-Policy': ["default-src 'self'"] };
    evaluateHeaders([a, b], request('https://a.com/x'), null, { kind: 'response', headers: response });
    assert.deepEqual(response, { 'Content-Security-Policy': ["default-src 'self'", "worker-src 'none'"] });
  });

  it('gives the same result from a request-phase plan', () => {
    const ext = extension(EXT_A, [
      { id: 1, priority: 2, action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-a', operation: 'set', value: '1' }] }, condition: { urlFilter: '||a.com^' } },
      { id: 2, priority: 3, action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-a', operation: 'remove' }] }, condition: { urlFilter: '/x', responseHeaders: [{ header: 'x-kill' }] } },
      block(3, { urlFilter: '/y', responseHeaders: [{ header: 'x-block' }] }, 1),
      { id: 4, priority: 5, action: { type: 'allow' }, condition: { urlFilter: '/y/allowed' } },
    ]);
    const run = (url: string, responseHeaders: Record<string, string[]>) => {
      const info = request(url, 'script', { responseHeaders });
      const { plan } = evaluateBeforeRequest([ext], info, null, undefined, true);
      const planned = { ...responseHeaders };
      const direct = { ...responseHeaders };
      const a = evaluateHeaders([ext], info, null, { kind: 'response', headers: planned }, undefined, plan);
      const b = evaluateHeaders([ext], info, null, { kind: 'response', headers: direct });
      assert.deepEqual(planned, direct);
      assert.equal(a.block?.rule.id, b.block?.rule.id);
      return { headers: planned, block: a.block?.rule.id ?? null };
    };
    assert.deepEqual(run('https://a.com/x', {}), { headers: { 'x-a': ['1'] }, block: null });
    assert.deepEqual(run('https://a.com/x', { 'X-Kill': ['1'] }), { headers: { 'X-Kill': ['1'] }, block: null });
    assert.deepEqual(run('https://b.com/y', { 'X-Block': ['1'] }).block, 3);
    assert.deepEqual(run('https://b.com/y/allowed', { 'X-Block': ['1'] }).block, null);
  });

  it('ignores modifyHeaders at or below a matching allow rule', () => {
    const ext = extension(EXT_A, [
      { id: 1, priority: 5, action: { type: 'allow' }, condition: { urlFilter: '||a.com^' } },
      { id: 2, priority: 5, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'x-a', operation: 'set', value: '1' }] }, condition: { urlFilter: '||a.com^' } },
      { id: 3, priority: 6, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'x-b', operation: 'set', value: '1' }] }, condition: { urlFilter: '||a.com^' } },
    ]);
    const headers: Record<string, string> = {};
    evaluateHeaders([ext], request('https://a.com/x'), null, { kind: 'request', headers });
    assert.deepEqual(headers, { 'x-b': '1' });
  });

  it('blocks on response header conditions', () => {
    const ext = extension(EXT_A, [block(1, { urlFilter: '/x', responseHeaders: [{ header: 'link', values: ['*rel=preconnect*'] }] })]);
    const hit = evaluateHeaders([ext], request('https://a.com/x', 'script', { responseHeaders: { Link: ['<https://c>; rel=preconnect'] } }), null, { kind: 'response', headers: {} });
    assert.equal(hit.block?.rule.id, 1);
    const miss = evaluateHeaders([ext], request('https://a.com/x', 'script', { responseHeaders: { Link: ['<https://c>; rel=preload'] } }), null, { kind: 'response', headers: {} });
    assert.equal(miss.block, null);
    assert.equal(outcome([ext], 'https://a.com/x'), null);
  });
});

describe('index', () => {
  it('files rules by host, request domain, token, initiator, or generic', () => {
    const ruleset = buildRuleset('r', 'static', [
      block(1, { urlFilter: '||ads.com^' }),
      block(2, { requestDomains: ['t1.com', 't2.com'] }),
      block(3, { urlFilter: '/banner/ad.' }),
      block(4, { initiatorDomains: ['site.com'] }),
      block(5, { urlFilter: 'ad' }),
      { id: 6, action: { type: 'nope' }, condition: {} },
    ], false);
    assert.deepEqual(
      { host: ruleset.stats.byHost, token: ruleset.stats.byToken, initiator: ruleset.stats.byInitiator, generic: ruleset.stats.generic, invalid: ruleset.stats.invalid },
      { host: 2, token: 1, initiator: 1, generic: 1, invalid: 1 },
    );
    const hits = (url: string, initiator = 'https://page.example') => {
      const info = request(url, 'script', { initiator });
      const ids: number[] = [];
      ruleset.index.forEachMatch(info, requestKeys(info), (rule) => ids.push(rule.id));
      return ids.sort();
    };
    assert.deepEqual(hits('https://x.ads.com/a'), [1, 5]);
    assert.deepEqual(hits('https://t2.com/'), [2]);
    assert.deepEqual(hits('https://cdn.com/banner/ad.png'), [3, 5]);
    assert.deepEqual(hits('https://cdn.com/x', 'https://www.site.com'), [4]);
  });

  it('merges rulesets without their disabled rules', () => {
    const one = buildRuleset('one', 'static', [block(1, { urlFilter: '||a.com^' }), block(2, { urlFilter: '/ad.js' })], false);
    const two = buildRuleset('two', 'static', [block(1, { urlFilter: '||a.com^' })], false);
    one.disabled = new Set([1]);
    const merged = mergeRulesets([one, two]);
    const info = request('https://a.com/ad.js');
    const hits: string[] = [];
    merged.forEachMatch(info, requestKeys(info), (rule) => hits.push(`${rule.rulesetId}#${rule.id}`));
    assert.deepEqual(hits.sort(), ['one#2', 'two#1']);
  });

  it('is fast on a large ruleset', () => {
    const rules: Rule[] = [];
    for (let i = 1; i <= 50_000; i += 1) {
      if (i % 3 === 0) rules.push(block(i, { urlFilter: `||host${i}.example^` }));
      else if (i % 3 === 1) rules.push(block(i, { urlFilter: `/path${i}/ad.js`, domainType: 'thirdParty' }));
      else rules.push(block(i, { urlFilter: `/x${i}.gif`, initiatorDomains: [`site${i}.com`] }));
    }
    let start = performance.now();
    const ruleset = buildRuleset('big', 'static', rules, false);
    const buildMs = performance.now() - start;
    const ext: ExtensionRules = { extensionId: EXT_A, installRank: 1, indexes: [ruleset.index], permission: 'all', hasHostAccess: () => true };
    const urls = Array.from({ length: 2000 }, (_, i) => `https://cdn${i}.example.org/assets/path${i * 7}/ad.js?v=${i}&cb=${i * 13}`);
    const infos = urls.map((url) => request(url));
    start = performance.now();
    for (const info of infos) evaluateBeforeRequest([ext], info, 'https://page.example');
    const perRequestUs = ((performance.now() - start) / infos.length) * 1000;
    assert.ok(buildMs < 2000, `build took ${buildMs} ms`);
    assert.ok(perRequestUs < 200, `match took ${perRequestUs} µs`);
    console.log(`[dnr] 50k rules: build ${buildMs.toFixed(0)} ms, match ${perRequestUs.toFixed(1)} µs/request`);
  });
});
