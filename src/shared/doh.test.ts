import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextDnsTemplate, resolveSecureDns, validateDohTemplate, type SecureDnsSettings } from './doh';

test('validateDohTemplate accepts plain and {?dns} https templates', () => {
  assert.equal(validateDohTemplate('https://dns.example/dns-query'), 'https://dns.example/dns-query');
  assert.equal(validateDohTemplate('  https://dns.example/dns-query{?dns}  '), 'https://dns.example/dns-query{?dns}');
  assert.equal(validateDohTemplate('https://dns.example:8443/q'), 'https://dns.example:8443/q');
  assert.equal(validateDohTemplate('https://dns.example/q?x=1'), 'https://dns.example/q?x=1');
});

test('validateDohTemplate rejects non-https, malformed and unsafe templates', () => {
  for (const bad of [
    '',
    '   ',
    42,
    null,
    'http://dns.example/dns-query',
    'dns.example/dns-query',
    'https://',
    'https://user:pw@dns.example/dns-query',
    'https://dns.example/dns-query#frag',
    'https://dns.example/{dns}',
    'https://dns.example/dns-query{?dns}{?dns}',
    'https://dns.example/dns-query{&dns}',
    'https://dns.example/q?x=1{?dns}',
    'https://dns.example/a b',
    `https://dns.example/${'a'.repeat(600)}`,
  ]) {
    assert.equal(validateDohTemplate(bad), null, String(bad));
  }
});

test('nextDnsTemplate accepts an ID or a NextDNS URL', () => {
  assert.equal(nextDnsTemplate('abc123'), 'https://dns.nextdns.io/abc123');
  assert.equal(nextDnsTemplate(' https://dns.nextdns.io/abc123/laptop '), 'https://dns.nextdns.io/abc123/laptop');
  assert.equal(nextDnsTemplate(''), null);
  assert.equal(nextDnsTemplate('abc-123'), null);
  assert.equal(nextDnsTemplate('https://evil.example/abc123'), null);
});

const base: SecureDnsSettings = { secureDns: 'off', secureDnsStrict: false, secureDnsNextDns: '', secureDnsTemplate: '' };

test('resolveSecureDns maps modes to resolver plans', () => {
  assert.deepEqual(resolveSecureDns(base), { secureDnsMode: 'off', secureDnsServers: [] });
  assert.deepEqual(resolveSecureDns({ ...base, secureDns: 'automatic', secureDnsStrict: true }), { secureDnsMode: 'automatic', secureDnsServers: [] });
  assert.deepEqual(resolveSecureDns({ ...base, secureDns: 'quad9' }), { secureDnsMode: 'automatic', secureDnsServers: ['https://dns.quad9.net/dns-query'] });
  assert.deepEqual(resolveSecureDns({ ...base, secureDns: 'mullvad-adblock', secureDnsStrict: true }), {
    secureDnsMode: 'secure',
    secureDnsServers: ['https://adblock.dns.mullvad.net/dns-query'],
  });
  assert.deepEqual(resolveSecureDns({ ...base, secureDns: 'nextdns', secureDnsNextDns: 'abc123', secureDnsStrict: true }), {
    secureDnsMode: 'secure',
    secureDnsServers: ['https://dns.nextdns.io/abc123'],
  });
  assert.deepEqual(resolveSecureDns({ ...base, secureDns: 'custom', secureDnsStrict: true }), { secureDnsMode: 'off', secureDnsServers: [] });
});
