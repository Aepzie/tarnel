import assert from 'node:assert/strict';
import { test } from 'node:test';
import { holdsProfile, planUserDataMigration, userDataOverride, type UserDataMigrationInput } from './plan';

const base: UserDataMigrationInput = {
  override: null,
  target: 'C:\\Users\\a\\AppData\\Roaming\\Tarnel',
  targetEntries: null,
  legacy: 'C:\\Users\\a\\AppData\\Roaming\\Vela',
  legacyEntries: ['Local State', 'Partitions', 'settings.json'],
};

test('TARNEL_USER_DATA wins, VELA_USER_DATA is the fallback', () => {
  assert.equal(userDataOverride({ TARNEL_USER_DATA: 'C:\\t', VELA_USER_DATA: 'C:\\v' }), 'C:\\t');
  assert.equal(userDataOverride({ VELA_USER_DATA: 'C:\\v' }), 'C:\\v');
  assert.equal(userDataOverride({ TARNEL_USER_DATA: '  ', VELA_USER_DATA: 'C:\\v' }), 'C:\\v');
  assert.equal(userDataOverride({}), null);
});

test('first start with an old Vela profile migrates it', () => {
  assert.deepEqual(planUserDataMigration(base), { action: 'migrate', from: base.legacy, to: base.target });
});

test('a target holding only startup files still counts as empty', () => {
  const plan = planUserDataMigration({ ...base, targetEntries: ['compile-cache', 'Crashpad'] });
  assert.equal(plan.action, 'migrate');
});

test('an existing Tarnel profile is never replaced', () => {
  assert.deepEqual(planUserDataMigration({ ...base, targetEntries: ['Local State', 'compile-cache'] }), {
    action: 'none',
    reason: 'target-in-use',
  });
});

test('nothing to migrate without an old profile', () => {
  assert.equal(planUserDataMigration({ ...base, legacyEntries: null }).action, 'none');
  assert.equal(planUserDataMigration({ ...base, legacyEntries: [] }).action, 'none');
  assert.equal(planUserDataMigration({ ...base, legacyEntries: ['compile-cache'] }).action, 'none');
});

test('an explicit profile directory disables migration', () => {
  assert.deepEqual(planUserDataMigration({ ...base, override: 'D:\\profile' }), { action: 'none', reason: 'override' });
});

test('same directory (case-insensitive file systems) is a no-op', () => {
  assert.equal(planUserDataMigration({ ...base, legacy: base.target.toUpperCase() + '\\' }).action, 'none');
});

test('holdsProfile ignores non-profile entries', () => {
  assert.equal(holdsProfile(null), false);
  assert.equal(holdsProfile(['SingletonLock', 'logs']), false);
  assert.equal(holdsProfile(['Cookies']), true);
});
