// Generates every logo asset from src/shared/brand-mark.ts (the single source of truth):
//
//   build/icon.svg        full-colour master (square tile)       README, Linux, reference
//   build/icon-mono.svg   single-colour glyph (currentColor)
//   build/icon.png        1024 master PNG
//   build/icons/<n>.png   Linux icon set (16 … 1024)
//   build/icon.ico        Windows: 16, 24, 32, 48, 64, 128, 256 (PNG-compressed entries)
//   build/icon.icns       macOS: Apple squircle with margin, 16 … 1024 incl. @2x
//
// Rasterized by Electron's offscreen renderer, so no image libraries are needed:
//
//   npm run icons
//
import { app, BrowserWindow } from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** [OSType, pixel size]; the @2x types (ic11–ic14, ic10) reuse the larger rasters. */
const ICNS_ENTRIES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
];

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Loads the TypeScript brand module through esbuild (already a dev dependency). */
async function loadBrand() {
  const result = await build({
    entryPoints: [join(root, 'src', 'shared', 'brand-mark.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

function pageFor(svg, size) {
  const encoded = Buffer.from(svg, 'utf8').toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    img{display:block;width:${size}px;height:${size}px}
  </style></head><body><img src="data:image/svg+xml;base64,${encoded}"></body></html>`;
}

/** Rasterizes the SVG natively at `size` (crisper than downscaling a large master). */
async function render(svg, size) {
  const win = new BrowserWindow({
    show: false,
    width: size,
    height: size,
    useContentSize: true,
    frame: false,
    transparent: true,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  try {
    await win.loadURL(`data:text/html;base64,${Buffer.from(pageFor(svg, size)).toString('base64')}`);
    await win.webContents.executeJavaScript(
      'Promise.all([...document.images].map((i) => i.decode())).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))',
    );
    for (let attempt = 0; attempt < 20; attempt++) {
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
      if (!image.isEmpty()) {
        const { width, height } = image.getSize();
        if (width !== size || height !== size) throw new Error(`capturePage returned ${width}x${height}, expected ${size}`);
        return image.toPNG();
      }
      await delay(100);
    }
    throw new Error(`capturePage returned an empty image at ${size}px`);
  } finally {
    win.destroy();
  }
}

/** ICO with PNG-compressed entries (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

/** ICNS made of PNG entries (macOS 10.7+). */
function icns(entries) {
  const chunks = entries.map(([type, png]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

async function rasterSet(svg, sizes) {
  const out = new Map();
  for (const size of sizes) out.set(size, await render(svg, size));
  return out;
}

async function emit(relativePath, contents) {
  await writeFile(join(root, relativePath), contents);
  console.log(relativePath);
}

async function main() {
  const brand = await loadBrand();
  const squareSvg = brand.brandIconSvg('square');
  const macSvg = brand.brandIconSvg('mac');
  await mkdir(join(buildDir, 'icons'), { recursive: true });

  await emit('build/icon.svg', `${squareSvg}\n`);
  await emit('build/icon-mono.svg', `${brand.brandGlyphSvg()}\n`);

  const square = await rasterSet(squareSvg, [...new Set([...LINUX_SIZES, ...ICO_SIZES])].sort((a, b) => a - b));
  await emit('build/icon.png', square.get(1024));
  for (const size of LINUX_SIZES) await emit(`build/icons/${size}.png`, square.get(size));
  await emit('build/icon.ico', ico(ICO_SIZES.map((size) => ({ size, png: square.get(size) }))));

  const mac = await rasterSet(macSvg, [...new Set(ICNS_ENTRIES.map(([, size]) => size))]);
  await emit('build/icon.icns', icns(ICNS_ENTRIES.map(([type, size]) => [type, mac.get(size)])));
}

app
  .whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on('window-all-closed', () => {});
