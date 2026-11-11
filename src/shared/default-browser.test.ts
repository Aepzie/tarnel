import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultAppsDeepLink,
  defaultBrowserMethod,
  defaultBrowserSupport,
  installScope,
  isDefaultForBoth,
  isSameExecutable,
} from './default-browser';

describe('defaultBrowserSupport', () => {
  it('refuses unpackaged dev runs on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      assert.equal(defaultBrowserSupport({ platform, packaged: false, portable: false }), 'dev');
    }
  });

  it('refuses the Windows portable build only', () => {
    assert.equal(defaultBrowserSupport({ platform: 'win32', packaged: true, portable: true }), 'portable');
    assert.equal(defaultBrowserSupport({ platform: 'linux', packaged: true, portable: true }), 'ready');
  });

  it('is ready for installed builds and unsupported elsewhere', () => {
    assert.equal(defaultBrowserSupport({ platform: 'win32', packaged: true, portable: false }), 'ready');
    assert.equal(defaultBrowserSupport({ platform: 'darwin', packaged: true, portable: false }), 'ready');
    assert.equal(defaultBrowserSupport({ platform: 'freebsd', packaged: true, portable: false }), 'unsupported');
  });
});

describe('defaultBrowserMethod', () => {
  it('opens Settings on Windows and sets it directly elsewhere', () => {
    assert.equal(defaultBrowserMethod('win32'), 'settings');
    assert.equal(defaultBrowserMethod('darwin'), 'direct');
    assert.equal(defaultBrowserMethod('linux'), 'direct');
  });
});

describe('isDefaultForBoth', () => {
  it('needs http and https', () => {
    assert.equal(isDefaultForBoth(true, true), true);
    assert.equal(isDefaultForBoth(true, false), false);
    assert.equal(isDefaultForBoth(false, true), false);
  });
});

describe('isSameExecutable', () => {
  const exe = 'C:\\Users\\a\\AppData\\Local\\Programs\\Vela\\Vela.exe';
  it('compares case-insensitively and ignores quotes and slashes', () => {
    assert.equal(isSameExecutable('c:/users/a/appdata/local/programs/vela/VELA.EXE', exe), true);
    assert.equal(isSameExecutable(`"${exe}"`, exe), true);
  });
  it('rejects other handlers and empty answers', () => {
    assert.equal(isSameExecutable('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', exe), false);
    assert.equal(isSameExecutable('', exe), false);
    assert.equal(isSameExecutable(null, exe), false);
  });
});

describe('defaultAppsDeepLink', () => {
  it('builds the per-user and per-machine links', () => {
    assert.equal(defaultAppsDeepLink('user'), 'ms-settings:defaultapps?registeredAppUser=Vela');
    assert.equal(defaultAppsDeepLink('machine'), 'ms-settings:defaultapps?registeredAppMachine=Vela');
  });
  it('encodes the app name', () => {
    assert.equal(defaultAppsDeepLink('user', 'Vela Beta&x'), 'ms-settings:defaultapps?registeredAppUser=Vela%20Beta%26x');
  });
});

describe('installScope', () => {
  const dirs = ['C:\\Program Files', 'C:\\Program Files (x86)', undefined];
  it('detects an all-users install under Program Files', () => {
    assert.equal(installScope('C:\\Program Files\\Vela\\Vela.exe', dirs), 'machine');
    assert.equal(installScope('c:\\program files (x86)\\Vela\\Vela.exe', dirs), 'machine');
  });
  it('treats everything else as per-user', () => {
    assert.equal(installScope('C:\\Users\\a\\AppData\\Local\\Programs\\Vela\\Vela.exe', dirs), 'user');
    assert.equal(installScope('C:\\Program Files Extra\\Vela.exe', dirs), 'user');
    assert.equal(installScope('C:\\Vela\\Vela.exe', ['']), 'user');
  });
});
