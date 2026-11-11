import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { downloadVerified, grantWindowsRuntimeAccess, installRuntime, parseCommand, runtimeTarget } from './drm-runtime.mjs';

const bytes = Buffer.from('verified runtime test archive');
const digest = createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'vela-drm-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('only published supported platform pairs produce an official pinned target', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const arch of ['x64', 'arm64']) {
      const target = runtimeTarget(platform, arch);
      assert.equal(target.version, '45.2.1+wvcus');
      assert.match(target.sha256, /^[a-f0-9]{64}$/);
      assert.ok(target.url.startsWith('https://github.com/castlabs/electron-releases/releases/download/'));
      assert.ok(target.url.includes(encodeURIComponent(`electron-v45.2.1+wvcus-${platform}-${arch}.zip`)));
    }
  }
  assert.throws(() => runtimeTarget('win32', 'ia32'), /not supported/);
  assert.throws(() => runtimeTarget('../elsewhere', 'x64'), /not supported/);
});

test('archive bytes must match the pinned SHA256 before extraction is possible', async (t) => {
  const root = await fixture(t);
  const archive = join(root, 'runtime.zip');
  await downloadVerified('https://example.test/runtime.zip', archive, digest, async () => new Response(bytes));
  assert.deepEqual(await readFile(archive), bytes);
  await assert.rejects(
    downloadVerified('https://example.test/runtime.zip', join(root, 'corrupt.zip'), digest, async () => new Response('modified')),
    /SHA256 mismatch/,
  );
  await assert.rejects(
    downloadVerified('https://example.test/runtime.zip', join(root, 'error.zip'), digest, async () => new Response('missing', { status: 404 })),
    /404/,
  );
});

test('installation is isolated, reusable offline, and only activated after extraction', async (t) => {
  const root = await fixture(t);
  const normal = join(root, 'node_modules', 'electron');
  await mkdir(normal, { recursive: true });
  await writeFile(join(normal, 'sentinel'), 'untouched');
  const target = { ...runtimeTarget('win32', 'x64'), sha256: digest };
  let requests = 0;
  let accessPreparations = 0;
  const options = {
    projectRoot: root,
    target,
    fetchImpl: async () => { requests++; return new Response(bytes); },
    prepareAccess: async () => { accessPreparations++; },
    extractArchive: async (_archive, { dir }) => {
      await writeFile(join(dir, 'version'), target.version);
      await writeFile(join(dir, 'electron.exe'), 'test executable');
    },
    log: () => {},
  };
  const first = await installRuntime(options);
  assert.ok(first.directory.startsWith(join(root, '.cache', 'drm-runtime')));
  assert.equal(await readFile(join(normal, 'sentinel'), 'utf8'), 'untouched');
  const again = await installRuntime({ ...options, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(again.executable, first.executable);
  assert.equal(requests, 1);
  assert.equal(accessPreparations, process.platform === 'win32' ? 2 : 0);
  await writeFile(first.executable, 'corrupted executable');
  await assert.rejects(installRuntime(options), /integrity verification/);
  assert.equal(requests, 1, 'a corrupt installation is reported without replacing existing files');
});

test('failed extraction never leaves an active runtime or staging directory', async (t) => {
  const root = await fixture(t);
  const target = { ...runtimeTarget('win32', 'x64'), sha256: digest };
  await assert.rejects(installRuntime({
    projectRoot: root, target,
    fetchImpl: async () => new Response(bytes),
    extractArchive: async () => { throw new Error('broken archive'); },
    log: () => {},
  }), /broken archive/);
  assert.deepEqual(await readdir(join(root, '.cache', 'drm-runtime')), []);
});

test('wrong extracted version is rejected and never activated', async (t) => {
  const root = await fixture(t);
  const target = { ...runtimeTarget('win32', 'x64'), sha256: digest };
  await assert.rejects(installRuntime({
    projectRoot: root, target,
    fetchImpl: async () => new Response(bytes),
    extractArchive: async (_archive, { dir }) => {
      await writeFile(join(dir, 'version'), '44.0.0');
      await writeFile(join(dir, 'electron.exe'), 'test executable');
    },
    log: () => {},
  }), /version mismatch/);
  assert.deepEqual(await readdir(join(root, '.cache', 'drm-runtime')), []);
});

test('start forwards Electron arguments without shell interpretation', () => {
  assert.deepEqual(parseCommand(['start', '--app', 'A:/app path', '--', '--remote-debugging-port=1234', '--user-agent=a b']), {
    command: 'start', appPath: 'A:/app path', args: ['--remote-debugging-port=1234', '--user-agent=a b'],
  });
  assert.equal(parseCommand(['install']).command, 'install');
  assert.equal(parseCommand(['path']).command, 'path');
  assert.throws(() => parseCommand(['start', '--app']), /requires a path/);
  assert.throws(() => parseCommand(['remove']), /Usage/);
  assert.throws(() => parseCommand(['install', '--unexpected']), /Usage/);
});

test('Windows permission grant is confined to the exact pinned runtime and uses read/execute only', async (t) => {
  const root = await fixture(t);
  const target = runtimeTarget('win32', 'x64');
  const directory = join(root, '.cache', 'drm-runtime', target.directoryName);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'electron.exe'), 'runtime');
  const calls = [];
  const run = async (command, args) => { calls.push({command, args}); };
  await grantWindowsRuntimeAccess(root, target, directory, run);
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /[\\/]System32[\\/]icacls\.exe$/i);
  assert.deepEqual(calls[0].args, [directory, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/T', '/Q', '/L']);
  await assert.rejects(grantWindowsRuntimeAccess(root, target, root, run), /exact pinned runtime/);
  assert.equal(calls.length, 1);
});

test('Windows permission grant rejects junctions in the runtime before launching icacls', async (t) => {
  const root = await fixture(t);
  const elsewhere = await fixture(t);
  const target = runtimeTarget('win32', 'x64');
  const directory = join(root, '.cache', 'drm-runtime', target.directoryName);
  await mkdir(directory, { recursive: true });
  await symlink(elsewhere, join(directory, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  let calls = 0;
  await assert.rejects(grantWindowsRuntimeAccess(root, target, directory, async () => { calls++; }), /symlink|junction|redirect/i);
  assert.equal(calls, 0);
});
