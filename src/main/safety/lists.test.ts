import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BlocklistIndex,
  hostCandidates,
  LIST_SOURCES,
  normalizeHost,
  normalizeUrl,
  parseAdblockHosts,
  parseHostList,
  parseUrlList,
} from './lists';

const source = (id: string) => LIST_SOURCES.find((s) => s.id === id)!;

describe('normalize', () => {
  it('hosts', () => {
    assert.equal(normalizeHost('Evil.Example.COM.'), 'evil.example.com');
    assert.equal(normalizeHost('localhost'), null);
    assert.equal(normalizeHost('com'), null);
    assert.equal(normalizeHost('bad host.com'), null);
    assert.equal(normalizeHost('a'.repeat(64) + '.com'), null);
  });
  it('urls drop the fragment and keep path + query', () => {
    assert.equal(normalizeUrl('HTTP://Evil.Test:80/a/b.exe?x=1#frag'), 'http://evil.test/a/b.exe?x=1');
    assert.equal(normalizeUrl('ftp://evil.test/x'), null);
    assert.equal(normalizeUrl('not a url'), null);
  });
});

describe('parsers', () => {
  it('URLhaus text list', () => {
    const text = '#####\n# URLhaus\n#####\nhttp://1.2.3.4/bins/x.sh\r\nhttps://evil.test/a.exe\n\ngarbage\n';
    assert.deepEqual(parseUrlList(text), ['http://1.2.3.4/bins/x.sh', 'https://evil.test/a.exe']);
  });
  it('domain list and hosts file', () => {
    const text = '# Phishing Army\nphish.test\n0.0.0.0 hosts-style.test # trailing\n127.0.0.1 localhost\nUPPER.Test\n';
    assert.deepEqual(parseHostList(text), ['phish.test', 'hosts-style.test', 'upper.test']);
  });
  it('adblock: whole-host block rules only', () => {
    const text = [
      '! Title: Badware risks',
      '||scam.test^',
      '||doc-only.test^$doc',
      '||all.test^$all,important',
      '||script-only.test^$script',
      '||path.test/download^',
      '@@||allowed.test^',
      'cosmetic.test##.ad',
      '||wild*.test^',
      '/regex/',
    ].join('\n');
    assert.deepEqual(parseAdblockHosts(text), ['scam.test', 'doc-only.test', 'all.test']);
  });
});

describe('hostCandidates', () => {
  it('walks up to the registrable domain', () => {
    assert.deepEqual(hostCandidates('a.b.example.co.uk'), ['a.b.example.co.uk', 'b.example.co.uk', 'example.co.uk']);
    assert.deepEqual(hostCandidates('example.com'), ['example.com']);
    assert.deepEqual(hostCandidates('user.github.io'), ['user.github.io']);
  });
});

describe('BlocklistIndex', () => {
  const index = new BlocklistIndex();
  index.add(source('urlhaus'), ['https://compromised.test/wp-content/x.exe']);
  index.add(source('phishing-army'), ['phish.test', 'github.io']);
  index.add(source('ublock-badware'), ['scam.test']);

  it('counts entries', () => assert.equal(index.size, 4));
  it('exact URL (URLhaus) without blocking the rest of the host', () => {
    assert.equal(index.match('https://compromised.test/wp-content/x.exe#a')?.source.id, 'urlhaus');
    assert.equal(index.match('https://compromised.test/'), null);
  });
  it('exact host and subdomains (host lists)', () => {
    assert.equal(index.match('https://phish.test/login')?.source.id, 'phishing-army');
    const sub = index.match('http://login.secure.phish.test/');
    assert.equal(sub?.source.threat, 'phishing');
    assert.equal(sub?.entry, 'phish.test');
    assert.equal(index.match('https://scam.test')?.source.id, 'ublock-badware');
  });
  it('does not match lookalikes or shared suffixes', () => {
    assert.equal(index.match('https://notphish.test/'), null);
    assert.equal(index.match('https://phish.test.example.com/'), null);
    assert.equal(index.match('https://someone.github.io/'), null);
  });
  it('ignores non-http URLs', () => {
    assert.equal(index.match('vela://newtab/'), null);
    assert.equal(index.match('file:///C:/phish.test'), null);
  });
});
