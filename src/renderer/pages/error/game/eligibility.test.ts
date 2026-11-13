import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canPlayOffline } from './eligibility';

test('internet-disconnected errors offer play even when the OS reports an online LAN', () => {
  assert.equal(canPlayOffline('ERR_INTERNET_DISCONNECTED', true), true);
  assert.equal(canPlayOffline('ERR_INTERNET_DISCONNECTED', false), true);
});

test('other network errors offer play only while offline', () => {
  for (const code of ['ERR_NAME_NOT_RESOLVED', 'ERR_NETWORK_CHANGED', 'ERR_CONNECTION_TIMED_OUT', 'ERR_ADDRESS_UNREACHABLE']) {
    assert.equal(canPlayOffline(code, false), true, code);
    assert.equal(canPlayOffline(code, true), false, code);
  }
});

test('security, file, proxy and unknown errors never offer the offline game', () => {
  for (const code of ['ERR_CERT_AUTHORITY_INVALID', 'ERR_SSL_PROTOCOL_ERROR', 'ERR_BLOCKED_BY_CLIENT', 'ERR_BLOCKED_BY_ADMINISTRATOR', 'ERR_FILE_NOT_FOUND', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_FAILED', 'crashed', '']) {
    assert.equal(canPlayOffline(code, false), false, code);
    assert.equal(canPlayOffline(code, true), false, code);
  }
});
