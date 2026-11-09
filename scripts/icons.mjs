// Generates build/icon.png (1024) and build/icons/<size>.png from build/icon.svg.
// Uses Electron's offscreen renderer, so no extra npm dependencies are needed.
//
//   npx electron scripts/icons.mjs
//
import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const svgPath = join(buildDir, 'icon.svg');
const MASTER = 1024;
const SIZES = [16, 32, 48, 64, 128, 256, 512];

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pageFor(svg, size) {
  const encoded = Buffer.from(svg, 'utf8').toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    img{display:block;width:${size}px;height:${size}px}
  </style></head><body><img src="data:image/svg+xml;base64,${encoded}"></body></html>`;
}

async function render(svg, size) {
  const win = new BrowserWindow({
    show: false,
    width: size,
    height: size,
    useContentSize: true,
    frame: false,
    transparent: true,
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
        return width === size && height === size ? image : image.resize({ width: size, height: size, quality: 'best' });
      }
      await delay(100);
    }
    throw new Error(`capturePage returned an empty image at ${size}px`);
  } finally {
    win.destroy();
  }
}

async function main() {
  const svg = await readFile(svgPath, 'utf8');
  await mkdir(join(buildDir, 'icons'), { recursive: true });

  const master = await render(svg, MASTER);
  await writeFile(join(buildDir, 'icon.png'), master.toPNG());
  console.log(`build/icon.png (${MASTER})`);

  for (const size of SIZES) {
    // Each size is rasterized natively from the SVG; this is crisper than downscaling the master.
    const image = await render(svg, size);
    await writeFile(join(buildDir, 'icons', `${size}.png`), image.toPNG());
    console.log(`build/icons/${size}.png`);
  }
}

app.whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on('window-all-closed', () => {});
