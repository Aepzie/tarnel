import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeApiError,
  formatAccountNumber,
  normalizeAccountNumber,
  parseApiError,
  parseLogin,
  parseNodes,
  parseProxyList,
  parseProxyWithPassword,
  normalizeTotp,
} from './vpn';

const SAMPLE = '1234567890123456';

test('account numbers: 16 digits, spaces / dashes from a paste are fine', () => {
  assert.equal(normalizeAccountNumber(SAMPLE), SAMPLE);
  assert.equal(normalizeAccountNumber('1234 5678 9012 3456'), SAMPLE);
  assert.equal(normalizeAccountNumber(' 1234-5678-9012-3456 '), SAMPLE);
  assert.equal(normalizeAccountNumber('1234 5678 9012 345'), null);
  assert.equal(normalizeAccountNumber('MNTL-ABCD-EFGH-IJKL'), null);
  assert.equal(normalizeAccountNumber('12345678901234567'), null);
});

test('account numbers are grouped in fours while typing', () => {
  assert.equal(formatAccountNumber('12345'), '1234 5');
  assert.equal(formatAccountNumber('1234-5678 9012x3456 99'), '1234 5678 9012 3456');
  assert.equal(formatAccountNumber(''), '');
});

test('login response needs a token and a paid-until date', () => {
  const paidUntil = '2027-01-01T00:00:00.000Z';
  assert.deepEqual(parseLogin({ token: 'a'.repeat(43), account: { id: 'acc_1', paidUntil } }), { token: 'a'.repeat(43), paidUntil });
  assert.equal(parseLogin({ token: 'short', account: { paidUntil } }), null);
  assert.equal(parseLogin({ token: 'a'.repeat(43), account: { paidUntil: 'nope' } }), null);
});

test('nodes map to servers; malformed entries are skipped', () => {
  const servers = parseNodes([
    { id: 'de-fra', city: 'Frankfurt', country: 'DE', endpointHost: '198.51.100.12', endpointPort: 51820, online: true, latencyMs: 4 },
    { id: 'ch-gva', city: 'Genf', country: 'CH', online: true, status: 'full' },
    { id: 'bad id!', city: 'X', country: 'DE', online: true },
    { id: 'sg-sin', city: 'Singapur', country: 'SG', online: false },
  ]);
  assert.ok(servers);
  assert.deepEqual(
    servers.map((server) => [server.id, server.country, server.ping, server.status, server.online]),
    [
      ['de-fra', 'Germany', 4, null, true],
      ['ch-gva', 'Switzerland', null, 'full', true],
      ['sg-sin', 'Singapore', null, null, false],
    ],
  );
  assert.equal(parseNodes({}), null);
});

test('proxies: list and create (password only on create)', () => {
  const proxy = { id: 'px_1', name: 'Vela', nodeId: 'de-fra', host: '198.51.100.12', port: 31000, protocol: 'http', exit: 'direct', username: 'm-ab12', enabled: true, status: 'active' };
  assert.equal(parseProxyList({ proxies: [proxy, { ...proxy, port: 0 }] })?.length, 1);
  assert.equal(parseProxyWithPassword({ proxy, password: 'p' })?.password, 'p');
  assert.equal(parseProxyWithPassword({ proxy }), null);
});

test('API errors become short user-facing copy', () => {
  assert.deepEqual(parseApiError({ code: 'unknown_code', error: 'x' }), { code: 'unknown_code', message: 'x' });
  assert.match(describeApiError(401, 'unknown_code'), /does not exist/);
  assert.match(describeApiError(429, null), /Too many/);
});

test('a 403 is only two-factor when Mantel says so', () => {
  assert.doesNotMatch(describeApiError(403, null), /authenticator/);
  assert.match(describeApiError(401, 'totp_required'), /authenticator app/);
  assert.match(describeApiError(401, 'totp_invalid'), /did not work/);
  assert.match(describeApiError(403, 'account_expired'), /no active time/);
  assert.equal(describeApiError(403, 'forbidden', 'Not allowed from this client.'), 'Mantel: Not allowed from this client. (forbidden, 403)');
});

test('two-factor codes are 6 to 8 digits', () => {
  assert.equal(normalizeTotp('123 456'), '123456');
  assert.equal(normalizeTotp('12345678'), '12345678');
  assert.equal(normalizeTotp('12345'), null);
  assert.equal(normalizeTotp('12a456'), null);
  assert.equal(normalizeTotp(42), null);
});
