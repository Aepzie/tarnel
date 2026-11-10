import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, 'src/renderer');

/**
 * Multi-page renderer build.
 * - chrome UI is loaded via file://dist/renderer/chrome/index.html
 * - internal pages are served via vela://<page>/ → dist/renderer/pages/<page>/
 *   Shared chunks land in dist/renderer/assets/. Because `base` is relative, a page at
 *   vela://newtab/index.html references "../../assets/x.js", which URL normalization clamps to
 *   vela://newtab/assets/x.js — the protocol handler maps /assets/* for every host, so every
 *   page loads its modules same-origin (no CORS privileges needed on the scheme).
 */
export default defineConfig(({ mode }) => ({
  root,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': root, '@shared': resolve(__dirname, 'src/shared') },
  },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: mode !== 'production',
    minify: mode === 'production',
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    rollupOptions: {
      input: {
        chrome: resolve(root, 'chrome/index.html'),
        newtab: resolve(root, 'pages/newtab/index.html'),
        settings: resolve(root, 'pages/settings/index.html'),
        error: resolve(root, 'pages/error/index.html'),
        history: resolve(root, 'pages/history/index.html'),
        passwords: resolve(root, 'pages/passwords/index.html'),
      },
    },
  },
}));
