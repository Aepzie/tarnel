import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests: every `src/**\/*.test.ts` is bundled with esbuild (no test framework, no new
 * dependencies) and run with Node's built-in runner (`node --test`). Tests must only import pure
 * modules (no `electron`).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function findTests(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findTests(path)));
    else if (entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

const tests = await findTests(join(root, 'src'));
const outdir = await mkdtemp(join(tmpdir(), 'vela-test-'));
try {
  await build({
    entryPoints: tests,
    outdir,
    outbase: join(root, 'src'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outExtension: { '.js': '.mjs' },
    external: ['electron'],
    logLevel: 'warning',
  });
  const files = tests.map((test) => join(outdir, relative(join(root, 'src'), test)).replace(/\.ts$/, '.mjs'));
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(outdir, { recursive: true, force: true });
}
