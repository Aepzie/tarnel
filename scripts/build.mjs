import { build as esbuild, context } from 'esbuild';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = join(root, 'dist');
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
const mode = production ? 'production' : 'development';

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
    external: ['electron', '@ghostery/*'],
  },
  {
    ...shared,
    entryPoints: [join(src, 'preload', 'chrome.ts'), join(src, 'preload', 'pages.ts')],
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
    build: watch ? { watch: {} } : {},
  });
}

await rm(out, { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all(nodeConfigs.map((config) => context(config)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  await buildRenderer();
  console.log('[vela] watching…');
} else {
  await Promise.all([...nodeConfigs.map((config) => esbuild(config)), buildRenderer()]);
  console.log('[vela] build complete');
}
