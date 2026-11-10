import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPermissions, coversAllSites, hostLabel, overallRisk, requestedHosts } from './risk';

test('all-sites host access is high risk', () => {
  const list = classifyPermissions({ host_permissions: ['<all_urls>'], permissions: ['storage'] });
  assert.deepEqual(list.map((entry) => entry.id), ['hosts:all']);
  assert.equal(list[0]!.label, 'Read and change all your data on all websites');
  assert.equal(overallRisk(list), 'high');
});

test('content script matches count as host access', () => {
  const list = classifyPermissions({ content_scripts: [{ matches: ['https://*/*'] }] });
  assert.equal(list[0]!.id, 'hosts:all');
});

test('MV2 host patterns inside permissions are recognised', () => {
  assert.deepEqual(requestedHosts({ permissions: ['tabs', 'https://example.com/*'] }), ['https://example.com/*']);
  const list = classifyPermissions({ permissions: ['tabs', 'https://example.com/*'] });
  assert.ok(list.some((entry) => entry.id === 'hosts:some' && entry.label.includes('example.com')));
  assert.ok(list.some((entry) => entry.id === 'tabs'));
  assert.equal(overallRisk(list), 'medium');
});

test('specific hosts are listed, then summarised', () => {
  const hosts = ['https://a.com/*', 'https://*.b.com/*', 'https://c.com/*', 'https://d.com/*', 'https://e.com/*'];
  const [entry] = classifyPermissions({ host_permissions: hosts });
  assert.equal(entry!.label, 'Read and change your data on a.com, b.com, c.com and 2 more');
  assert.equal(entry!.risk, 'medium');
});

test('dangerous APIs are high, silent ones hidden, unknown ones low', () => {
  const list = classifyPermissions({ permissions: ['storage', 'alarms', 'debugger', 'nativeMessaging', 'proxy', 'history', 'fancyThing'] });
  const byId = new Map(list.map((entry) => [entry.id, entry.risk]));
  assert.equal(byId.get('debugger'), 'high');
  assert.equal(byId.get('nativeMessaging'), 'high');
  assert.equal(byId.get('proxy'), 'high');
  assert.equal(byId.get('history'), 'high');
  assert.equal(byId.get('fancyThing'), 'low');
  assert.equal(byId.has('storage'), false);
  assert.equal(byId.has('alarms'), false);
});

test('cookies, webRequest and tabs are medium; sorted high first', () => {
  const list = classifyPermissions({ permissions: ['cookies', 'webRequest', 'tabs', 'debugger'] });
  assert.equal(list[0]!.id, 'debugger');
  for (const entry of list.slice(1)) assert.equal(entry.risk, 'medium');
});

test('nothing requested is low with an empty list', () => {
  const list = classifyPermissions({});
  assert.deepEqual(list, []);
  assert.equal(overallRisk(list), 'low');
});

test('ignores malformed manifest fields', () => {
  assert.deepEqual(classifyPermissions({ permissions: 'tabs', host_permissions: [42, null], content_scripts: [null, { matches: 'x' }] }), []);
});

test('host helpers', () => {
  assert.equal(coversAllSites('*://*/*'), true);
  assert.equal(coversAllSites('https://*/path/*'), true);
  assert.equal(coversAllSites('https://*.example.com/*'), false);
  assert.equal(hostLabel('*://*.example.com/*'), 'example.com');
  assert.equal(hostLabel('http://localhost:*/*'), 'localhost');
});
