import { app } from 'electron';
import { enableCompileCache } from 'node:module';
import { join } from 'node:path';
import { resolveUserData } from './user-data';

/**
 * Startup entry (dist/main/index.js). Turns on Node's on-disk V8 compile cache before the main
 * bundle (dist/main/app.js) is required, so later launches deserialize its bytecode instead of
 * parsing and compiling it again. The cache is keyed by file content, so a new build simply misses.
 * VELA_NO_COMPILE_CACHE=1 disables it (for A/B startup measurements).
 *
 * userData is settled first (TARNEL_USER_DATA, or the one-time move of a pre-rename Vela profile),
 * since the compile cache and the single-instance lock both live in it.
 */
resolveUserData();

if (process.env.VELA_NO_COMPILE_CACHE !== '1') {
  try {
    enableCompileCache(join(app.getPath('userData'), 'compile-cache'));
  } catch {
    /* no cache: identical behaviour, just a slower start */
  }
}

require('./app.js');
