import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VpnServer } from './vpn';
import { countriesOf, normalizeCountry, pickServer, routeKey, routedPartition } from './vpn-route';

const server = (id: string, countryCode: string, extra: Partial<VpnServer> = {}): VpnServer => ({
  id,
  country: countryCode === 'NL' ? 'Netherlands' : countryCode === 'DE' ? 'Germany' : 'Iceland',
  countryCode,
  city: id,
  online: true,
  load: null,
  ping: null,
  status: null,
  ...extra,
});

test('country keys: two letters, lower case, nothing else', () => {
  assert.equal(normalizeCountry('NL'), 'nl');
  assert.equal(normalizeCountry(' de '), 'de');
  assert.equal(normalizeCountry('nld'), null);
  assert.equal(normalizeCountry('n1'), null);
  assert.equal(normalizeCountry('../x'), null);
  assert.equal(normalizeCountry(7), null);
});

test('partitions and session keys separate Space and country', () => {
  assert.equal(routedPartition('ab12', false, 'nl'), 'persist:space-ab12-vpn-nl');
  assert.equal(routedPartition('ab12', true, 'nl'), 'space-ab12-vpn-nl');
  assert.equal(routeKey('ab12', null), 'ab12');
  assert.equal(routeKey('ab12', 'nl'), 'ab12@vpn-nl');
});

test('server choice: usable first, lowest ping, never offline or full', () => {
  const servers = [
    server('de-ber', 'DE', { ping: 7 }),
    server('de-fra', 'DE', { ping: 4 }),
    server('de-full', 'DE', { ping: 1, status: 'full' }),
    server('de-off', 'DE', { ping: 1, online: false }),
    server('is-rkv', 'IS', { online: false }),
  ];
  assert.equal(pickServer(servers, 'de')?.id, 'de-fra');
  assert.equal(pickServer(servers, 'is'), null);
  assert.equal(pickServer(servers, 'nl'), null);
  assert.equal(pickServer([server('nl-b', 'NL'), server('nl-a', 'NL')], 'nl')?.id, 'nl-a');
});

test('countries: one per code, alphabetical, available if any server is', () => {
  const list = countriesOf([server('nl-ams', 'NL'), server('de-off', 'DE', { online: false }), server('de-fra', 'DE'), server('is-rkv', 'IS', { online: false })]);
  assert.deepEqual(list, [
    { code: 'de', name: 'Germany', available: true },
    { code: 'is', name: 'Iceland', available: false },
    { code: 'nl', name: 'Netherlands', available: true },
  ]);
});
