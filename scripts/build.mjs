import { build as esbuild, context } from 'esbuild';
import { rm } from 'node:fs/promises';
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
    ...shared,
    entryPoints: [join(src, 'main', 'index.ts')],
    outfile: join(out, 'main', 'index.js'),
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
    ...shared,
    entryPoints: [join(src, 'preload', 'chrome.ts'), join(src, 'preload', 'pages.ts'), join(src, 'preload', 'fingerprint.ts'), join(src, 'preload', 'fingerprint-worker.ts'), join(src, 'preload', 'audio-devices.ts'), join(src, 'preload', 'audio-mixer.ts'), join(src, 'preload', 'identity.ts'), join(src, 'preload', 'extension-api.ts')],
    outdir: join(out, 'preload'),
    platform: 'node',
    format: 'cjs',
    target: 'chrome130',
    external: ['electron'],
  },
];

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

if (watch) {
  const contexts = await Promise.all(nodeConfigs.map((config) => context(config)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  await buildRenderer();
  console.log('[vela] watchingâ€¦');
} else {
  await Promise.all([...nodeConfigs.map((config) => esbuild(config)), buildRenderer()]);
  console.log('[vela] build complete');
}
