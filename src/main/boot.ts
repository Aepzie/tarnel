import { app } from 'electron';
import { enableCompileCache } from 'node:module';
import { join } from 'node:path';

/**
 * Startup entry (dist/main/index.js). Turns on Node's on-disk V8 compile cache before the main
 * bundle (dist/main/app.js) is required, so later launches deserialize its bytecode instead of
 * parsing and compiling it again. The cache is keyed by file content, so a new build simply misses.
 * VELA_NO_COMPILE_CACHE=1 disables it (for A/B startup measurements).
 */
if (process.env.VELA_NO_COMPILE_CACHE !== '1') {
  try {
    enableCompileCache(join(process.env.VELA_USER_DATA || app.getPath('userData'), 'compile-cache'));
  } catch {
    /* no cache: identical behaviour, just a slower start */
  }
}

require('./app.js');
