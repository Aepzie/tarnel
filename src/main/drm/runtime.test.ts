import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectCdmComponents } from './runtime';

test('detects the ECS API without relying on a version suffix or calling pre-ready methods', () => {
  const components = {
    WIDEVINE_CDM_ID: 'widevine',
    whenReady: () => { throw new Error('must not run before ready'); },
    status: () => { throw new Error('must not run before ready'); },
  };
  assert.equal(detectCdmComponents({ components }), components);
  assert.equal(detectCdmComponents({}), null);
  assert.equal(detectCdmComponents({ components: {} }), null);
  assert.equal(detectCdmComponents({ get components() { throw new Error('unsupported'); } }), null);
});
