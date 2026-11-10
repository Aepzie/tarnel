import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanLanguage, cleanTimezone, languageList, resolveTimezone, timezoneForCountry } from './fingerprint';

test('automatic timezone: UTC in strict, VPN zone when routed, system in standard', () => {
  assert.equal(resolveTimezone(undefined, true, null), 'UTC');
  assert.equal(resolveTimezone('', true, 'de'), 'Europe/Berlin');
  assert.equal(resolveTimezone('', false, 'de'), null);
});

test('explicit timezone settings', () => {
  assert.equal(resolveTimezone('system', true, 'jp'), null);
  assert.equal(resolveTimezone('vpn', false, 'jp'), 'Asia/Tokyo');
  assert.equal(resolveTimezone('vpn', false, null), null);
  assert.equal(resolveTimezone('vpn', true, null), 'UTC');
  assert.equal(resolveTimezone('America/New_York', true, 'jp'), 'America/New_York');
  assert.equal(timezoneForCountry('zz'), 'UTC');
});

test('settings are validated', () => {
  assert.equal(cleanTimezone(undefined, 'vpn'), 'vpn');
  assert.equal(cleanTimezone('America/Argentina/Buenos_Aires'), 'America/Argentina/Buenos_Aires');
  assert.throws(() => cleanTimezone('../etc'));
  assert.throws(() => cleanTimezone(5));
  assert.equal(cleanLanguage('de-DE'), 'de-DE');
  assert.equal(cleanLanguage(''), '');
  assert.throws(() => cleanLanguage('de;q=1'));
});

test('language list adds the base language', () => {
  assert.deepEqual(languageList('de-DE'), ['de-DE', 'de']);
  assert.deepEqual(languageList('en'), ['en']);
});
