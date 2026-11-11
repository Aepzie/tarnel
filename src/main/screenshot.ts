import { app, clipboard, ClipboardItem, dialog, nativeImage, screen, type WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SCREENSHOT_IPC,
  parseImageDataUrl,
  planFullPage,
  screenshotFileName,
  type ScreenshotCapture,
  type ScreenshotFormat,
  type ScreenshotSaveResult,
} from '../shared/screenshot';
import { getActiveTab, getTabViewBounds, getTabWebContents } from './tabs';
import { getMainWindow } from './window';

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

interface ActivePage {
  wc: WebContents;
  bounds: ScreenshotCapture['bounds'];
}

function activePage(): ActivePage {
  const id = getActiveTab();
  const wc = id === null ? null : getTabWebContents(id);
  const bounds = id === null ? null : getTabViewBounds(id);
  if (!wc || wc.isDestroyed() || !bounds) throw new Error('No page to capture');
  return { wc, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `capturePage` fails (UnknownVizError) while the views are being restacked, e.g. when the palette that
 * started the screenshot releases the overlay at the same moment. A short retry rides that out.
 */
async function capturePageWithRetry(wc: WebContents): Promise<Electron.NativeImage> {
  for (let attempt = 0; ; attempt++) {
    try {
      const image = await wc.capturePage();
      if (!image.isEmpty()) return image;
      if (attempt >= 3) throw new Error('Empty capture');
    } catch (error) {
      if (attempt >= 3 || wc.isDestroyed()) throw error;
    }
    await delay(120);
  }
}

/** Run CDP commands on the tab; attaches only when nobody else (DevTools protocol client) is attached. */
async function withDebugger<T>(wc: WebContents, run: (send: (method: string, params?: object) => Promise<unknown>) => Promise<T>): Promise<T> {
  const dbg = wc.debugger;
  const ownAttach = !dbg.isAttached();
  if (ownAttach) dbg.attach('1.3');
  try {
    return await run((method, params) => dbg.sendCommand(method, params));
  } finally {
    if (ownAttach && dbg.isAttached()) dbg.detach();
  }
}

function fromCdpPng(data: string, bounds: ScreenshotCapture['bounds'], wc: WebContents, truncated: boolean): ScreenshotCapture {
  const size = nativeImage.createFromBuffer(Buffer.from(data, 'base64')).getSize();
  if (size.width === 0 || size.height === 0) throw new Error('Empty capture');
  return { dataUrl: `data:image/png;base64,${data}`, width: size.width, height: size.height, bounds, title: wc.getTitle(), truncated };
}

async function captureVisible(): Promise<ScreenshotCapture> {
  const { wc, bounds } = activePage();
  try {
    const image = await capturePageWithRetry(wc);
    const size = image.getSize();
    return { dataUrl: image.toDataURL(), width: size.width, height: size.height, bounds, title: wc.getTitle(), truncated: false };
  } catch {
    // No compositor frame to copy (e.g. a tab that was activated while the window is occluded): let
    // Chromium render the viewport once through CDP instead.
    const shot = (await withDebugger(wc, (send) => send('Page.captureScreenshot', { format: 'png', fromSurface: true }))) as { data: string };
    return fromCdpPng(shot.data, bounds, wc, false);
  }
}

/** Device pixels per CSS px of the page (display scale × page zoom); never read from the page itself. */
function deviceScaleOf(wc: WebContents): number {
  const win = getMainWindow();
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  return display.scaleFactor * wc.getZoomFactor();
}

interface LayoutMetrics {
  cssContentSize?: { width: number; height: number };
  contentSize?: { width: number; height: number };
}

/** Whole page via CDP: Chromium renders beyond the viewport in one pass, no scrolling or stitching in JS. */
async function captureFullPage(): Promise<ScreenshotCapture> {
  const { wc, bounds } = activePage();
  return withDebugger(wc, async (send) => {
    const metrics = (await send('Page.getLayoutMetrics')) as LayoutMetrics;
    const content = metrics.cssContentSize ?? metrics.contentSize ?? { width: bounds.width, height: bounds.height };
    const plan = planFullPage(content.width, content.height, deviceScaleOf(wc));
    const shot = (await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      fromSurface: true,
      clip: { x: 0, y: 0, width: plan.width, height: plan.height, scale: plan.scale },
    })) as { data: string };
    return fromCdpPng(shot.data, bounds, wc, plan.truncated);
  });
}

function imageFrom(value: unknown): Electron.NativeImage {
  const parsed = parseImageDataUrl(value);
  if (!parsed) throw new TypeError('Invalid image');
  const image = nativeImage.createFromBuffer(Buffer.from(parsed.base64, 'base64'));
  if (image.isEmpty()) throw new TypeError('Invalid image');
  return image;
}

function format(value: unknown): ScreenshotFormat {
  if (value !== 'png' && value !== 'jpeg') throw new TypeError('Invalid format');
  return value;
}

async function save(dataUrl: unknown, fmt: unknown): Promise<ScreenshotSaveResult> {
  const kind = format(fmt);
  const image = imageFrom(dataUrl);
  const filters =
    kind === 'jpeg' ? [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }] : [{ name: 'PNG image', extensions: ['png'] }];
  const options = { defaultPath: join(app.getPath('downloads'), screenshotFileName(new Date(), kind)), filters };
  const win = getMainWindow();
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { saved: false, path: null };
  await writeFile(result.filePath, kind === 'jpeg' ? image.toJPEG(92) : image.toPNG());
  return { saved: true, path: result.filePath };
}

/** `handle` is ipc.ts's chrome-only (sender-checked) registrar. */
export function registerScreenshotIpc(handle: ChromeHandler): void {
  handle(SCREENSHOT_IPC.captureVisible, () => captureVisible());
  handle(SCREENSHOT_IPC.captureFullPage, () => captureFullPage());
  handle(SCREENSHOT_IPC.copy, async (dataUrl) => {
    const png = new Uint8Array(imageFrom(dataUrl).toPNG());
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  });
  handle(SCREENSHOT_IPC.save, (dataUrl, fmt) => save(dataUrl, fmt));
}
