import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_VERSION = '45.2.1+wvcus';
// Official release asset SHA256 digests, verified on 2026-11-11. Keep this pin independent
// from stock Electron: ECS 45.2.3 is not published. Updating requires reviewing all digests.
// https://github.com/castlabs/electron-releases/releases/tag/v45.2.1%2Bwvcus
const DIGESTS = Object.freeze({
  'darwin-arm64': '93e1976a66d58004bf25e5b777c979cc3c03513868d5faf294bcd6f58e63bd24',
  'darwin-x64': '865396e65fc869c2d824a77e1c1bb4c2f5d3392566f00b5e5edeeec1b3f11bed',
  'linux-arm64': '4eaa98ae93b98377f1fb3b8ab403a2132a301cd04f05322fcf4a90d29ac68ce1',
  'linux-x64': '18953cdab1cdc2499f9b0089f85d069559bf992145008a40aacd0d7714b97960',
  'win32-arm64': 'cfc28c52aa189d3feef1f188179aa1dcf1d9dbacba957e895370b6b637a0afd2',
  'win32-x64': 'a17f87a95a62e8f336d6fa18e57b9bc83d513b02211e4e5771a45cfd7482740e',
});
const MARKER = 'tarnel-runtime.json';
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

export async function resolveArchiveExtractor(load = () => import('@electron-internal/extract-zip')) {
  try { return (await load()).extract; }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
      throw new Error('Missing @electron-internal/extract-zip from Electron tooling. Run npm ci in the project root, then retry npm run drm:install.', { cause: error });
    }
    throw error;
  }
}

function samePath(left, right) {
  return process.platform === 'win32' ? resolve(left).toLowerCase() === resolve(right).toLowerCase() : resolve(left) === resolve(right);
}

async function assertNoRedirect(location) {
  const info = await lstat(location);
  if (info.isSymbolicLink() || !samePath(await realpath(location), location)) {
    throw new Error(`Refusing a symlink, junction or redirected runtime path: ${location}`);
  }
  return info;
}

async function assertNoRedirectsInTree(directory) {
  const info = await assertNoRedirect(directory);
  if (info.isDirectory()) {
    for (const entry of await readdir(directory)) await assertNoRedirectsInTree(join(directory, entry));
  }
}

async function runIcacls(command, args) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = (bytes) => { output = (output + bytes.toString()).slice(-8192); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? done() : reject(new Error(`icacls exited ${code}: ${output.trim()}`)));
  });
}

/** Give Chromium's AppContainer read/execute access only to our verified runtime binaries. */
export async function grantWindowsRuntimeAccess(projectRoot, target, directory, run = runIcacls, log = console.log) {
  const root = await realpath(projectRoot);
  const pinned = runtimeTarget(target.platform, target.arch);
  const expected = join(root, '.cache', 'drm-runtime', pinned.directoryName);
  if (target.platform !== 'win32' || !samePath(directory, expected)) {
    throw new Error('Windows ACL changes are only allowed on the exact pinned runtime directory.');
  }
  for (const ancestor of [join(root, '.cache'), join(root, '.cache', 'drm-runtime')]) await assertNoRedirect(ancestor);
  await assertNoRedirectsInTree(expected);
  const command = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe');
  log(`Granting AppContainer S-1-15-2-1 inherited read/execute (RX) only, recursively inside the pinned runtime: ${expected}`);
  // /L also avoids following links if one is introduced after the checks above.
  await run(command, [expected, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/T', '/Q', '/L']);
}

export function runtimeTarget(platform = process.platform, arch = process.arch) {
  const sha256 = DIGESTS[`${platform}-${arch}`];
  if (!sha256) throw new Error(`DRM runtime is not supported on ${platform}/${arch}; supported: Windows, macOS and Linux, x64/arm64.`);
  const filename = `electron-v${RUNTIME_VERSION}-${platform}-${arch}.zip`;
  return Object.freeze({
    version: RUNTIME_VERSION, platform, arch, sha256,
    directoryName: `${RUNTIME_VERSION}-${platform}-${arch}`,
    executable: platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron',
    url: `https://github.com/castlabs/electron-releases/releases/download/${encodeURIComponent(`v${RUNTIME_VERSION}`)}/${encodeURIComponent(filename)}`,
  });
}

export async function downloadVerified(url, destination, expected, fetchImpl = fetch) {
  if (new URL(url).protocol !== 'https:') throw new Error('Runtime downloads require HTTPS.');
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(300_000), redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Runtime download failed (HTTP ${response.status}).`);
  const hash = createHash('sha256');
  let bytes = 0;
  const verify = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_DOWNLOAD_BYTES) return callback(new Error('Runtime archive exceeds the download size limit.'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(destination, { flags: 'wx' }));
  if (hash.digest('hex') !== expected) throw new Error('Runtime archive SHA256 mismatch; the archive will not be extracted.');
}

async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function requireChild(parent, child) {
  const rel = relative(parent, child);
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('Runtime cache path must stay inside the project directory.');
  }
}

async function checkExtracted(directory, target) {
  const version = (await readFile(join(directory, 'version'), 'utf8')).trim().replace(/^v/, '');
  if (version !== target.version) throw new Error(`Runtime version mismatch: expected ${target.version}, found ${version}.`);
  const executable = join(directory, target.executable);
  await access(executable);
  return { directory, executable, version };
}

async function readInstalled(directory, target) {
  let marker;
  let legacy = false;
  try {
    let contents;
    try { contents = await readFile(join(directory, MARKER), 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      contents = await readFile(join(directory, 'vela-runtime.json'), 'utf8');
      legacy = true;
    }
    marker = JSON.parse(contents);
  }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Invalid DRM runtime installation at ${directory}: ${error.message}`);
  }
  if (!marker || marker.version !== target.version || marker.archiveSha256 !== target.sha256) {
    throw new Error(`DRM runtime verification record does not match the pinned release: ${directory}`);
  }
  const runtime = await checkExtracted(directory, target);
  if (await fileHash(runtime.executable) !== marker.executableSha256) throw new Error(`Cached DRM runtime executable failed integrity verification: ${directory}`);
  if (legacy) {
    // Reuse verified pre-rename caches without replacing binaries or an existing current record.
    await assertNoRedirect(directory);
    await writeFile(join(directory, MARKER), JSON.stringify(marker) + '\n', { flag: 'wx' });
  }
  return runtime;
}

export async function installRuntime({
  projectRoot = ROOT,
  target = runtimeTarget(),
  fetchImpl = fetch,
  extractArchive,
  prepareAccess = grantWindowsRuntimeAccess,
  log = console.log,
} = {}) {
  const root = await realpath(projectRoot);
  const cacheParent = join(root, '.cache');
  await mkdir(cacheParent, { recursive: true });
  await assertNoRedirect(cacheParent);
  const cache = join(cacheParent, 'drm-runtime');
  await mkdir(cache, { recursive: true });
  await assertNoRedirect(cache);
  const directory = resolve(cache, target.directoryName);
  requireChild(cache, directory);
  const installed = await readInstalled(directory, target);
  if (installed) {
    if (process.platform === 'win32' && target.platform === 'win32') await prepareAccess(root, target, directory, undefined, log);
    log(`DRM runtime: Electron ${installed.version} (${target.platform}/${target.arch}), verified cache.`);
    return installed;
  }
  // Resolve optional tooling before downloading a large archive. Cached runtimes need none.
  const extract = extractArchive ?? await resolveArchiveExtractor();
  const staging = await mkdtemp(join(cache, 'tarnel-drm-runtime-'));
  requireChild(cache, await realpath(staging));
  try {
    const archive = join(staging, 'runtime.zip');
    const extracted = join(staging, 'runtime');
    log(`Downloading official DRM runtime: Electron ${target.version} (${target.platform}/${target.arch}).`);
    await downloadVerified(target.url, archive, target.sha256, fetchImpl);
    await mkdir(extracted);
    await extract(archive, { dir: extracted });
    const runtime = await checkExtracted(extracted, target);
    await writeFile(join(extracted, MARKER), JSON.stringify({
      version: runtime.version,
      archiveSha256: target.sha256,
      executableSha256: await fileHash(runtime.executable),
    }) + '\n', { flag: 'wx' });
    try { await rename(extracted, directory); }
    catch (error) {
      // Another installer may have finished first. Never overwrite an existing directory.
      if (!(await readInstalled(directory, target))) throw error;
    }
    const installed = await readInstalled(directory, target);
    if (process.platform === 'win32' && target.platform === 'win32') await prepareAccess(root, target, directory, undefined, log);
    log(`DRM runtime installed: Electron ${target.version}. Stock Electron and the lockfile are unchanged.`);
    return installed;
  } finally {
    // Only our newly created, contained staging directory is ever recursively removed.
    requireChild(cache, await realpath(staging));
    await rm(staging, { recursive: true, force: true });
  }
}

export function parseCommand(argv) {
  const [command, ...rest] = argv;
  const usage = 'Usage: node scripts/drm-runtime.mjs install | path | start [--app <path>] [-- <Electron arguments>]';
  if (!['install', 'path', 'start'].includes(command)) throw new Error(usage);
  if (command !== 'start' && rest.length) throw new Error(usage);
  let appPath = ROOT;
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--') { args.push(...rest.slice(i + 1)); break; }
    if (rest[i] === '--app') {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('--app requires a path.');
      appPath = rest[++i];
    } else args.push(rest[i]);
  }
  return { command, appPath, args };
}

async function main() {
  const { command, appPath, args } = parseCommand(process.argv.slice(2));
  if (command === 'path') {
    const target = runtimeTarget();
    const installed = await readInstalled(join(ROOT, '.cache', 'drm-runtime', target.directoryName), target);
    if (!installed) throw new Error('DRM runtime is not installed. Run: node scripts/drm-runtime.mjs install');
    console.log(installed.executable);
    return;
  }
  const installed = await installRuntime();
  if (command === 'install') return;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // This is the interactive browser, not a background helper. SW_HIDE suppresses its first
  // ShowWindow call on Windows and can leave the browser running without a visible window.
  const child = spawn(installed.executable, [resolve(appPath), ...args], { cwd: ROOT, env, stdio: 'inherit', windowsHide: false });
  const stop = () => child.kill();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
      done();
    });
  });
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`DRM runtime: ${error.message}`);
    process.exitCode = 1;
  });
}
