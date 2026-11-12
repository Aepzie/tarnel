import { build as esbuild, context } from 'esbuild';
import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = join(root, 'dist');
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
// React/Vite always build in production mode (dev React is ~3x larger and slower, which skews
// every memory/perf measurement). `--dev-react` opts into development builds for debugging.
// `--production` only controls minification and sourcemaps.
const mode = process.argv.includes('--dev-react') ? 'development' : 'production';

const shared = {
  bundle: true,
  sourcemap: production ? false : 'linked',
  minify: production,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
};

/** Main process + sandboxed preloads (esbuild). The renderer is built by Vite. */
const nodeConfigs = [
  {
    // Tiny startup entry (package.json "main"): enables Node's V8 compile cache, then requires app.js.
    ...shared,
    entryPoints: [join(src, 'main', 'boot.ts')],
    outfile: join(out, 'main', 'index.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron', './app.js'],
  },
  {
    ...shared,
    entryPoints: [join(src, 'main', 'index.ts')],
    outfile: join(out, 'main', 'app.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    // Extension libraries stay in node_modules: they resolve their preload scripts from there, and
    // being external keeps them out of the startup bundle (loaded only when an extension runs).
    external: ['electron', '@ghostery/*', 'electron-chrome-extensions', 'electron-chrome-web-store', 'electron-updater'],
  },
  {
    // Sync engine: a separate bundle, required by main only when sync is turned on.
    ...shared,
    entryPoints: [join(src, 'main', 'sync', 'engine.ts')],
    outfile: join(out, 'main', 'sync.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
  },
  {
    // Cookie banner rule engine: its own bundle, required by main when the first web frame asks for
    // rules. The rule list itself is copied next to it (copyCookieBannerRules) and read lazily.
    ...shared,
    entryPoints: [join(src, 'main', 'cookie-banners', 'rules.ts')],
    outfile: join(out, 'main', 'cookie-banners.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
  },
  {
    // On-device translation engine: runs in its own utilityProcess, spawned only when a page is translated.
    ...shared,
    entryPoints: [join(src, 'main', 'translate', 'engine-process.ts')],
    outfile: join(out, 'main', 'translate-engine.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
  },
  {
    // Runs in every web frame: always minified so the per-frame parse stays small.
    ...shared,
    minify: true,
    entryPoints: [join(src, 'preload', 'cookie-banners.ts'), join(src, 'preload', 'adblock-early.ts')],
    outdir: join(out, 'preload'),
    platform: 'node',
    format: 'cjs',
    target: 'chrome130',
    external: ['electron'],
  },
  {
    ...shared,
    entryPoints: [join(src, 'preload', 'chrome.ts'), join(src, 'preload', 'pages.ts'), join(src, 'preload', 'fingerprint.ts'), join(src, 'preload', 'fingerprint-worker.ts'), join(src, 'preload', 'audio-devices.ts'), join(src, 'preload', 'audio-mixer.ts'), join(src, 'preload', 'identity.ts'), join(src, 'preload', 'extension-api.ts'), join(src, 'preload', 'passwords.ts')],
    outdir: join(out, 'preload'),
    platform: 'node',
    format: 'cjs',
    target: 'chrome130',
    external: ['electron'],
  },
];

/** DuckDuckGo autoconsent's compact rule list (MPL-2.0), bundled at build time; never fetched at runtime. */
async function copyCookieBannerRules() {
  const require = createRequire(import.meta.url);
  await mkdir(join(out, 'main'), { recursive: true });
  await copyFile(require.resolve('@duckduckgo/autoconsent/rules/compact-rules.json'), join(out, 'main', 'cookie-banner-rules.json'));
}

async function buildRenderer() {
  const vite = await import('vite');
  await vite.build({
    configFile: join(root, 'vite.config.mts'),
    mode,
    logLevel: 'warn',
    build: { minify: production, sourcemap: !production, ...(watch ? { watch: {} } : {}) },
  });
}

await rm(out, { recursive: true, force: true });
await copyCookieBannerRules();
// Vendored bergamot-translator WASM + glue (MPL-2.0), loaded by the translation engine at runtime.
await cp(join(root, 'vendor', 'bergamot'), join(out, 'vendor', 'bergamot'), { recursive: true });

if (watch) {
  const contexts = await Promise.all(nodeConfigs.map((config) => context(config)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  await buildRenderer();
  console.log('[tarnel] watchingâ€¦');
} else {
  await Promise.all([...nodeConfigs.map((config) => esbuild(config)), buildRenderer()]);
  console.log('[tarnel] build complete');
}
