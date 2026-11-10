import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvField, loginsToCsv } from './csv';
import { displayHost, isSecureOrigin, normaliseOrigin, originMatches } from './origin';
import { classify, emptyVault, loginsFor, parseVault, upsert, type Cipher } from './vault';

/** Stand-in for safeStorage: reversible, and never equal to the plain text. */
const fakeCipher: Cipher = {
  encrypt: (plain) => Buffer.from(`sealed:${plain}`, 'utf8').toString('base64'),
  decrypt: (sealed) => {
    const text = Buffer.from(sealed, 'base64').toString('utf8');
    if (!text.startsWith('sealed:')) throw new Error('bad ciphertext');
    return text.slice('sealed:'.length);
  },
};

let counter = 0;
const nextId = (): string => `id-${(counter += 1)}`;

test('normaliseOrigin keeps scheme, host and non-default port only', () => {
  assert.equal(normaliseOrigin('HTTPS://Accounts.Example.COM:443/login?next=/x#y'), 'https://accounts.example.com');
  assert.equal(normaliseOrigin('http://example.com:80/'), 'http://example.com');
  assert.equal(normaliseOrigin('http://localhost:8080/login'), 'http://localhost:8080');
  assert.equal(normaliseOrigin('https://example.com.:8443'), 'https://example.com:8443');
  assert.equal(normaliseOrigin('https://user:pw@example.com/'), 'https://example.com');
  assert.equal(normaliseOrigin('https://[::1]:3000/'), 'https://[::1]:3000');
  assert.equal(normaliseOrigin('  https://example.com  '), 'https://example.com');
  for (const bad of ['', 'example.com', 'ftp://example.com', 'javascript:alert(1)', 'file:///C:/x', 'vela://passwords/', 'data:text/html,x', 'chrome-extension://abc/']) {
    assert.equal(normaliseOrigin(bad), null, bad);
  }
});

test('matching is exact on origin: no subdomain, scheme or port sharing', () => {
  const saved = 'https://example.com';
  assert.equal(originMatches(saved, 'https://example.com/login'), true);
  assert.equal(originMatches(saved, 'https://EXAMPLE.com:443/'), true);
  assert.equal(originMatches(saved, 'http://example.com/'), false);
  assert.equal(originMatches(saved, 'https://evil.example.com/'), false);
  assert.equal(originMatches(saved, 'https://example.com.evil.test/'), false);
  assert.equal(originMatches(saved, 'https://example.com:8443/'), false);
  assert.equal(displayHost('http://localhost:8080'), 'localhost:8080');
  assert.equal(isSecureOrigin('https://example.com'), true);
  assert.equal(isSecureOrigin('http://localhost:8080'), true);
  assert.equal(isSecureOrigin('http://example.com'), false);
});

test('loginsFor returns only the same origin, most recently used first', () => {
  let vault = emptyVault();
  vault = upsert(vault, fakeCipher, { origin: 'https://a.test', username: 'one', password: 'p1' }, 1, nextId).vault;
  vault = upsert(vault, fakeCipher, { origin: 'https://a.test', username: 'two', password: 'p2' }, 2, nextId).vault;
  vault = upsert(vault, fakeCipher, { origin: 'https://b.test', username: 'three', password: 'p3' }, 3, nextId).vault;
  vault = { ...vault, logins: vault.logins.map((login) => (login.username === 'one' ? { ...login, lastUsedAt: 10 } : login)) };
  assert.deepEqual(loginsFor(vault, 'https://a.test').map((login) => login.username), ['one', 'two']);
  assert.deepEqual(loginsFor(vault, 'http://a.test'), []);
});

test('encryption round trip: stored passwords are sealed and decrypt back', () => {
  const { vault, result } = upsert(emptyVault(), fakeCipher, { origin: 'https://example.com', username: 'test', password: 'test123' }, 1, nextId);
  assert.equal(result, 'added');
  const stored = vault.logins[0];
  assert.notEqual(stored.password, 'test123');
  assert.ok(!JSON.stringify(vault).includes('test123'));
  assert.equal(fakeCipher.decrypt(stored.password), 'test123');
  const reloaded = parseVault(JSON.parse(JSON.stringify(vault)));
  assert.equal(fakeCipher.decrypt(reloaded.logins[0].password), 'test123');
});

test('upsert: same password is unchanged, a new one updates, input vault is untouched', () => {
  const first = upsert(emptyVault(), fakeCipher, { origin: 'https://example.com', username: 'test', password: 'test123' }, 1, nextId).vault;
  assert.equal(classify(first, fakeCipher, 'https://example.com', 'test', 'test123'), 'unchanged');
  assert.equal(classify(first, fakeCipher, 'https://example.com', 'test', 'other'), 'updated');
  assert.equal(classify(first, fakeCipher, 'https://example.com', 'someone', 'test123'), 'added');
  const second = upsert(first, fakeCipher, { origin: 'https://example.com', username: 'test', password: 'new-pass' }, 2, nextId);
  assert.equal(second.result, 'updated');
  assert.equal(second.vault.logins.length, 1);
  assert.equal(fakeCipher.decrypt(second.vault.logins[0].password), 'new-pass');
  assert.equal(fakeCipher.decrypt(first.logins[0].password), 'test123');
  assert.throws(() => upsert(first, fakeCipher, { origin: 'https://example.com', username: 'x', password: '' }, 3, nextId));
});

test('parseVault drops malformed entries and non-normalised origins', () => {
  const vault = parseVault({
    logins: [
      { id: 'a', origin: 'https://ok.test', username: 'u', password: 'c2VhbGVkOng=', createdAt: 1 },
      { id: 'b', origin: 'https://OK.test/path', username: 'u', password: 'x', createdAt: 1 },
      { id: 'c', origin: 'javascript:x', username: 'u', password: 'x', createdAt: 1 },
      { id: 4, origin: 'https://ok.test', username: 'u', password: 'x', createdAt: 1 },
      null,
    ],
    never: ['https://never.test', 'nope', 'https://never.test'],
  });
  assert.deepEqual(vault.logins.map((login) => login.id), ['a']);
  assert.deepEqual(vault.never, ['https://never.test']);
  assert.deepEqual(parseVault('garbage'), emptyVault());
});

test('CSV export escapes commas, quotes, newlines and edge whitespace', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line1\nline2'), '"line1\nline2"');
  assert.equal(csvField('cr\rx'), '"cr\rx"');
  assert.equal(csvField(' padded '), '" padded "');
  assert.equal(csvField(''), '');
  const csv = loginsToCsv([{ origin: 'https://example.com', username: 'te,st', password: 'p"w\n1' }]);
  assert.equal(csv, 'name,url,username,password,note\r\nexample.com,https://example.com,"te,st","p""w\n1",\r\n');
});
