/**
 * Native ECS smoke: node scripts/test-drm-native.cjs [--download-cdm]
 * Windows require AppContainer RX access (prepared by drm-runtime.mjs).
 * All windows stay hidden; only local test pages load. --download-cdm explicitly
 * permits Google's component download into a temporary, subsequently removed profile.
 * This tests native CDM availability/policy, not production VMP or Netflix playback.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.cache');

async function launch() {
  const args = process.argv.slice(2);
  assert(args.every((arg) => arg === '--download-cdm'), 'Usage: node scripts/test-drm-native.cjs [--download-cdm]');
  const download = args.includes('--download-cdm');
  const { installRuntime } = await import(pathToFileURL(path.join(__dirname, 'drm-runtime.mjs')).href);
  const runtime = await installRuntime();
  const directory = await fs.mkdtemp(path.join(cache, 'drm-smoke-'));
  const profile = path.join(directory, 'profile');
  const summary = { runtime: runtime.version, downloadAllowed: download, runs: [] };
  const resultFile = path.join(cache, 'drm-native-smoke-results.json');
  try {
    const modes = download ? ['off', 'install', 'on', 'off-after'] : ['off'];
    for (const mode of modes) {
      const output = path.join(directory, `${mode}.json`);
      const env = { ...process.env, VELA_DRM_TEST_PROFILE: profile, VELA_DRM_TEST_RESULT: output, VELA_DRM_TEST_MODE: mode };
      delete env.ELECTRON_RUN_AS_NODE;
      const { spawn } = require('node:child_process');
      await new Promise((resolve, reject) => {
        const child = spawn(runtime.executable, [__filename], { cwd: root, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let logs = '';
        const collect = (chunk) => { logs = (logs + chunk.toString()).slice(-8192); };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        const timeout = setTimeout(() => { child.kill(); reject(new Error(`${mode}: native test timed out.`)); }, 70000);
        child.once('error', (error) => { clearTimeout(timeout); reject(error); });
        child.once('close', (code) => {
          clearTimeout(timeout);
          code === 0 ? resolve() : reject(new Error(`${mode}: native test exited ${code}. ${logs.trim()}`));
        });
      });
      const result = JSON.parse(await fs.readFile(output, 'utf8'));
      summary.runs.push(result);
      assert.equal(result.error, undefined, `${mode}: ${result.error}`);
      console.log(`Native DRM smoke: ${mode} passed.`);
    }
    summary.passed = true;
  } catch (error) {
    summary.passed = false;
    summary.error = error.message;
    throw error;
  } finally {
    await fs.writeFile(resultFile, JSON.stringify(summary, null, 2) + '\n');
    // Only remove this invocation's generated, direct child of the real cache.
    const actual = await fs.realpath(directory);
    assert.equal(path.dirname(actual), await fs.realpath(cache));
    assert(path.basename(actual).startsWith('drm-smoke-'));
    assert(!(await fs.lstat(directory)).isSymbolicLink());
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    console.log(`Native DRM evidence: ${resultFile}`);
  }
}

async function probe() {
  const { app, BrowserWindow, protocol, session, components } = require('electron');
  const mode = process.env.VELA_DRM_TEST_MODE;
  const profile = process.env.VELA_DRM_TEST_PROFILE;
  const output = process.env.VELA_DRM_TEST_RESULT;
  assert(['off', 'install', 'on', 'off-after'].includes(mode), 'Run this test with Node, not Electron directly.');
  assert(profile && output && path.dirname(profile) === path.dirname(output));
  const directory = path.dirname(profile);
  assert.equal(path.dirname(directory), cache);
  assert(path.basename(directory).startsWith('drm-smoke-'));
  const off = mode.startsWith('off');
  const result = {
    mode, versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    preReadyApi: { whenReady: typeof components?.whenReady, id: components?.WIDEVINE_CDM_ID },
    cases: [],
  };
  assert.equal(result.preReadyApi.whenReady, 'function', 'This smoke requires the optional ECS runtime.');
  app.setPath('userData', profile);
  if (off) {
    app.commandLine.appendSwitch('disable-component-update');
    app.commandLine.appendSwitch('override-enabled-cdm-interface-version', '0');
  }
  protocol.registerSchemesAsPrivileged([{ scheme: 'drm-smoke', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  app.on('window-all-closed', () => {});
  const timeout = setTimeout(async () => {
    result.error = 'Native probe timeout';
    await fs.writeFile(output, JSON.stringify(result, null, 2));
    app.exit(2);
  }, 65000);
  try {
    await app.whenReady();
    assert(!app.commandLine.hasSwitch('no-sandbox'), 'Chromium sandbox must remain enabled.');
    result.sandbox = true;
    if (!off) {
      components.updatesEnabled = true;
      result.components = await components.whenReady([components.WIDEVINE_CDM_ID]);
      assert(result.components.some((component) => component.id === components.WIDEVINE_CDM_ID && component.version));
    }
    if (mode !== 'install') {
      const ses = session.fromPartition(`drm-smoke-${mode}`);
      ses.setPermissionCheckHandler(() => false);
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      ses.protocol.handle('drm-smoke', (request) => new Response('<!doctype html><title>Local DRM test</title>', {
        headers: { 'content-type': 'text/html', ...(request.url.includes('/deny') ? { 'Permissions-Policy': 'encrypted-media=()' } : {}) },
      }));
      for (const policy of [false, true]) {
        const win = new BrowserWindow({ show: false, x: -20000, y: -20000, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
        try {
          await win.loadURL(`drm-smoke://local/${policy ? 'deny' : 'allow'}`);
          const keys = await win.webContents.executeJavaScript(`(async () => {
            const result = {secure:isSecureContext};
            for (const key of ['org.w3.clearkey','com.widevine.alpha']) {
              try {
                const access = await navigator.requestMediaKeySystemAccess(key,[{initDataTypes:['cenc'],videoCapabilities:[{contentType:'video/mp4; codecs="avc1.42E01E"'}],distinctiveIdentifier:'not-allowed',persistentState:'not-allowed',sessionTypes:['temporary']}]);
                await access.createMediaKeys(); result[key] = 'available';
              } catch(error) { result[key] = error.name; }
            }
            return result;
          })()`);
          result.cases.push({ policy, ...keys });
          assert.equal(keys.secure, true);
          assert.equal(keys['com.widevine.alpha'], policy ? 'SecurityError' : off ? 'NotSupportedError' : 'available');
          assert.equal(keys['org.w3.clearkey'], policy ? 'SecurityError' : 'available');
        } finally { win.destroy(); }
      }
    }
  } catch (error) {
    result.error = error.stack;
    console.error(error.message);
  } finally {
    clearTimeout(timeout);
    await fs.writeFile(output, JSON.stringify(result, null, 2));
    app.exit(result.error ? 1 : 0);
  }
}

(process.versions.electron ? probe() : launch()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
