import type { ContentBounds } from './types';

/**
 * Screenshots (Ctrl+Shift+X, palette, page context menu). Main captures the active tab (visible part via
 * `capturePage`, full page via CDP `Page.captureScreenshot`), the chrome selects an area and edits the
 * image on a canvas, and main writes the result to the clipboard or a file. Pure helpers live here
 * (unit-tested in screenshot.test.ts).
 */

export const SCREENSHOT_IPC = {
  /** Visible part of the active tab. */
  captureVisible: 'chrome:screenshot-capture-visible',
  /** Whole page of the active tab, stitched by Chromium (long pages are cut at FULL_PAGE_MAX_CSS_HEIGHT). */
  captureFullPage: 'chrome:screenshot-capture-full-page',
  copy: 'chrome:screenshot-copy',
  save: 'chrome:screenshot-save',
} as const;

export type ScreenshotFormat = 'png' | 'jpeg';

export interface ScreenshotCapture {
  /** `data:image/png;base64,…` */
  dataUrl: string;
  /** Image size in pixels. */
  width: number;
  height: number;
  /** Where the tab's page view sits in the window (CSS px), for the area selection. */
  bounds: ContentBounds;
  title: string;
  /** Full-page capture was cut because the page is longer than the cap. */
  truncated: boolean;
}

export interface ScreenshotSaveResult {
  saved: boolean;
  path: string | null;
}

/** Longest page part a full-page capture covers (CSS px). */
export const FULL_PAGE_MAX_CSS_HEIGHT = 16_000;
/** Largest image side Chromium's canvas handles comfortably. */
export const MAX_IMAGE_SIDE = 16_384;
/** Data URLs bigger than this are rejected by main (≈ a 16k × 16k PNG of noise is far above any real page). */
export const MAX_DATA_URL_LENGTH = 200 * 1024 * 1024;

export interface FullPagePlan {
  width: number;
  height: number;
  /** Scale passed to `Page.captureScreenshot` (≤ 1 shrinks very wide/tall pages). */
  scale: number;
  truncated: boolean;
}

/** Clip and scale for a full-page capture of a page with the given CSS content size and device pixel ratio. */
export function planFullPage(contentWidth: number, contentHeight: number, deviceScale: number): FullPagePlan {
  const width = Math.max(1, Math.ceil(contentWidth));
  const fullHeight = Math.max(1, Math.ceil(contentHeight));
  const height = Math.min(fullHeight, FULL_PAGE_MAX_CSS_HEIGHT);
  const dpr = deviceScale > 0 && Number.isFinite(deviceScale) ? deviceScale : 1;
  const fit = Math.min(1, MAX_IMAGE_SIDE / (width * dpr), MAX_IMAGE_SIDE / (height * dpr));
  return { width, height, scale: Math.floor(fit * 1000) / 1000, truncated: height < fullHeight };
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rectangle spanned by two points, in any drag direction. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): PixelRect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/** Scale a rect by `factor`, round to whole pixels and clamp it into `limitWidth` × `limitHeight`. */
export function scaleRectInto(rect: PixelRect, factor: number, limitWidth: number, limitHeight: number): PixelRect {
  const x = Math.max(0, Math.min(limitWidth, Math.round(rect.x * factor)));
  const y = Math.max(0, Math.min(limitHeight, Math.round(rect.y * factor)));
  const right = Math.max(x, Math.min(limitWidth, Math.round((rect.x + rect.width) * factor)));
  const bottom = Math.max(y, Math.min(limitHeight, Math.round((rect.y + rect.height) * factor)));
  return { x, y, width: right - x, height: bottom - y };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Default file name, e.g. `Tarnel screenshot 2026-11-11 at 14.05.09.png` (no characters Windows forbids). */
export function screenshotFileName(date: Date, format: ScreenshotFormat): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  return `Tarnel screenshot ${day} at ${time}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}

/** Validates an image data URL coming from the renderer; returns the base64 payload or null. */
export function parseImageDataUrl(value: unknown): { mime: 'image/png' | 'image/jpeg'; base64: string } | null {
  if (typeof value !== 'string' || value.length > MAX_DATA_URL_LENGTH) return null;
  const match = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;
  return { mime: match[1] as 'image/png' | 'image/jpeg', base64: match[2] ?? '' };
}
