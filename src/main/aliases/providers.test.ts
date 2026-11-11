import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AliasApiError, apiBase, authHeaders, createAlias, parseAccount, parseAlias, parseDomains, parseMailboxes, validKey, type ApiRequest, type ApiResponse } from './providers';

const ok = (json: unknown, status = 200): ApiResponse => ({ status, json });

/** Records requests and answers them from a route table (documented response shapes). */
function fakeApi(routes: Record<string, ApiResponse>) {
  const seen: ApiRequest[] = [];
  const send = async (request: ApiRequest): Promise<ApiResponse> => {
    seen.push(request);
    const route = routes[`${request.method} ${request.path.split('?')[0]}`];
    if (!route) throw new Error(`unexpected ${request.method} ${request.path}`);
    return route;
  };
  return { seen, send };
}

test('base override only for loopback origins', () => {
  assert.equal(apiBase('simplelogin', undefined), 'https://app.simplelogin.io');
  assert.equal(apiBase('addy', ''), 'https://app.addy.io');
  assert.equal(apiBase('addy', 'http://127.0.0.1:9471'), 'http://127.0.0.1:9471');
  assert.equal(apiBase('simplelogin', 'http://localhost:9471/'), 'http://localhost:9471');
  assert.equal(apiBase('simplelogin', 'https://evil.example'), 'https://app.simplelogin.io');
  assert.equal(apiBase('simplelogin', 'http://127.0.0.1.evil.example'), 'https://app.simplelogin.io');
  assert.equal(apiBase('addy', 'http://127.0.0.1:1/api'), 'https://app.addy.io');
  assert.equal(apiBase('addy', 'file:///etc/passwd'), 'https://app.addy.io');
});

test('auth headers per provider', () => {
  assert.equal(authHeaders('simplelogin', 'k'.repeat(10)).Authentication, 'k'.repeat(10));
  const addy = authHeaders('addy', 'abc12345');
  assert.equal(addy.Authorization, 'Bearer abc12345');
  assert.equal(addy['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(validKey('short'), false);
  assert.equal(validKey('abc 12345'), false);
  assert.equal(validKey('a'.repeat(64)), true);
});

test('account parsing', () => {
  assert.deepEqual(parseAccount('simplelogin', ok({ name: 'A', email: 'a@example.com', is_premium: true, in_trial: false })), { name: 'a@example.com', plan: 'Premium' });
  assert.deepEqual(parseAccount('simplelogin', ok({ email: 'a@example.com', is_premium: false })), { name: 'a@example.com', plan: 'Free' });
  assert.deepEqual(parseAccount('addy', ok({ data: { username: 'johndoe', subscription: 'pro' } })), { name: 'johndoe', plan: 'Pro' });
  assert.throws(() => parseAccount('simplelogin', ok({ error: 'Wrong api key' }, 401)), (error: Error) => error instanceof AliasApiError && error.message === 'Wrong api key');
  assert.throws(() => parseAccount('addy', ok({ message: 'Unauthenticated.' }, 401)), /Unauthenticated/);
  assert.throws(() => parseAccount('addy', ok({}, 200)), AliasApiError);
});

test('alias parsing', () => {
  assert.deepEqual(parseAlias('simplelogin', ok({ id: 42, email: 'happy.cat@simplelogin.com', enabled: true }, 201)), { provider: 'simplelogin', id: '42', email: 'happy.cat@simplelogin.com' });
  assert.deepEqual(parseAlias('addy', ok({ data: { id: '50c9e585-e7f5-41c4-9016-9014c15454bc', email: 'abc@anonaddy.me' } }, 201)), {
    provider: 'addy',
    id: '50c9e585-e7f5-41c4-9016-9014c15454bc',
    email: 'abc@anonaddy.me',
  });
  assert.throws(() => parseAlias('addy', ok({ data: { id: '1', email: 'not an email' } }, 201)), AliasApiError);
  assert.throws(() => parseAlias('simplelogin', ok({ error: 'You have reached the limitation of a free account' }, 400)), /limitation/);
  assert.throws(() => parseAlias('addy', ok(null, 429)), /Too many requests/);
});

test('mailboxes and domains', () => {
  assert.deepEqual(parseMailboxes('simplelogin', ok({ mailboxes: [{ id: 1, email: 'a@b.co', default: true, verified: true }, { id: 2, email: 'x@y.co', verified: false }] })), [{ id: '1', label: 'a@b.co' }]);
  assert.deepEqual(parseMailboxes('addy', ok({ data: [{ id: 'r1', email: 'me@ex.com', email_verified_at: '2024-01-01' }, { id: 'r2', email: 'no@ex.com', email_verified_at: null }] })), [{ id: 'r1', label: 'me@ex.com' }]);
  assert.deepEqual(parseDomains(ok({ data: ['anonaddy.me', 'bad domain', 'johndoe.anonaddy.com'], defaultAliasDomain: 'anonaddy.me' })), [
    { id: 'anonaddy.me', label: 'anonaddy.me' },
    { id: 'johndoe.anonaddy.com', label: 'johndoe.anonaddy.com' },
  ]);
});

test('SimpleLogin random alias request', async () => {
  const api = fakeApi({ 'POST /api/alias/random/new': ok({ id: 7, email: 'brave.owl@slmail.me' }, 201) });
  const alias = await createAlias({ provider: 'simplelogin', style: 'words', site: 'example.com', domain: null, mailbox: null }, api.send);
  assert.equal(alias.email, 'brave.owl@slmail.me');
  assert.equal(api.seen[0].path, '/api/alias/random/new?hostname=example.com&mode=word');
  assert.deepEqual(api.seen[0].body, { note: 'Created by Vela' });
});

test('SimpleLogin site-based alias uses options + custom endpoint', async () => {
  const api = fakeApi({
    'GET /api/v5/alias/options': ok({ can_create: true, prefix_suggestion: 'example', suffixes: [{ suffix: '.x@sl.me', signed_suffix: 'premium.sig', is_premium: true }, { suffix: '.y@sl.me', signed_suffix: 'free.sig', is_premium: false }] }),
    'GET /api/v2/mailboxes': ok({ mailboxes: [{ id: 3, email: 'a@b.co', default: false }, { id: 9, email: 'c@d.co', default: true }] }),
    'POST /api/v3/alias/custom/new': ok({ id: 8, email: 'example.y@sl.me' }, 201),
  });
  const alias = await createAlias({ provider: 'simplelogin', style: 'site', site: 'example.com', domain: null, mailbox: null }, api.send);
  assert.equal(alias.email, 'example.y@sl.me');
  assert.deepEqual(api.seen[2].body, { alias_prefix: 'example', signed_suffix: 'free.sig', mailbox_ids: [9], note: 'Created by Vela' });
  const blocked = fakeApi({ 'GET /api/v5/alias/options': ok({ can_create: false, suffixes: [] }) });
  await assert.rejects(createAlias({ provider: 'simplelogin', style: 'site', site: 'a.com', domain: null, mailbox: null }, blocked.send), AliasApiError);
});

test('addy.io alias request', async () => {
  const api = fakeApi({
    'GET /api/v1/domain-options': ok({ data: ['anonaddy.me'], defaultAliasDomain: 'anonaddy.me' }),
    'POST /api/v1/aliases': ok({ data: { id: 'u1', email: 'shop@anonaddy.me' } }, 201),
  });
  await createAlias({ provider: 'addy', style: 'site', site: 'shop.co.uk', domain: null, mailbox: 'r1' }, api.send);
  assert.deepEqual(api.seen[1].body, { domain: 'anonaddy.me', description: 'Created by Vela for shop.co.uk', format: 'custom', local_part: 'shop', recipient_ids: ['r1'] });
  const direct = fakeApi({ 'POST /api/v1/aliases': ok({ data: { id: 'u2', email: 'x1y2@mydomain.com' } }, 201) });
  await createAlias({ provider: 'addy', style: 'chars', site: 'a.com', domain: 'mydomain.com', mailbox: null }, direct.send);
  assert.equal(direct.seen.length, 1);
  assert.equal(direct.seen[0].body?.format, 'random_characters');
});
