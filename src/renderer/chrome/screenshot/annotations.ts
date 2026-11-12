import type { PixelRect } from '@shared/screenshot';

/** Editor tools; every annotation is stored in image pixels (before crop). */
export type Tool = 'crop' | 'arrow' | 'rect' | 'pen' | 'text' | 'highlight' | 'blur';

export interface Point {
  x: number;
  y: number;
}

export type Annotation =
  | { kind: 'arrow'; color: string; width: number; from: Point; to: Point }
  | { kind: 'rect'; color: string; width: number; rect: PixelRect }
  | { kind: 'pen'; color: string; width: number; points: Point[] }
  | { kind: 'highlight'; color: string; width: number; points: Point[] }
  | { kind: 'text'; color: string; size: number; at: Point; text: string }
  | { kind: 'blur'; rect: PixelRect; block: number };

/** One undo step: annotations plus the crop applied so far. */
export interface EditorDoc {
  annotations: Annotation[];
  crop: PixelRect | null;
}

export const COLORS = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#ffffff', '#111827'] as const;

/** Stroke width that reads the same on a phone-sized and a 4K capture. */
export function strokeFor(width: number, height: number): number {
  return Math.max(3, Math.round(Math.min(width, height) / 220));
}

function strokePath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  const first = points[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  if (points.length === 1) ctx.lineTo(first.x + 0.01, first.y);
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, width: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(12, width * 4);
  const shaftEnd = { x: to.x - Math.cos(angle) * head * 0.6, y: to.y - Math.sin(angle) * head * 0.6 };
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(shaftEnd.x, shaftEnd.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - Math.cos(angle - Math.PI / 7) * head, to.y - Math.sin(angle - Math.PI / 7) * head);
  ctx.lineTo(to.x - Math.cos(angle + Math.PI / 7) * head, to.y - Math.sin(angle + Math.PI / 7) * head);
  ctx.closePath();
  ctx.fill();
}

/** Pixelate whatever is already painted under `rect` (image + earlier annotations), irreversibly in the export. */
function pixelate(ctx: CanvasRenderingContext2D, rect: PixelRect, block: number): void {
  const offset = ctx.getTransform();
  const left = Math.max(Math.round(rect.x), Math.round(-offset.e));
  const top = Math.max(Math.round(rect.y), Math.round(-offset.f));
  const right = Math.min(Math.round(rect.x + rect.width), Math.round(ctx.canvas.width - offset.e));
  const bottom = Math.min(Math.round(rect.y + rect.height), Math.round(ctx.canvas.height - offset.f));
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1) return;
  const x = left;
  const y = top;
  const sourceX = x + offset.e;
  const sourceY = y + offset.f;
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.ceil(width / block));
  small.height = Math.max(1, Math.ceil(height / block));
  const sctx = small.getContext('2d');
  if (!sctx) return;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(ctx.canvas, sourceX, sourceY, width, height, 0, 0, small.width, small.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, width, height);
  ctx.restore();
}

export function textFont(size: number): string {
  return `600 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: Annotation): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (annotation.kind) {
    case 'arrow':
      ctx.strokeStyle = annotation.color;
      ctx.fillStyle = annotation.color;
      ctx.lineWidth = annotation.width;
      drawArrow(ctx, annotation.from, annotation.to, annotation.width);
      break;
    case 'rect':
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.width;
      ctx.strokeRect(annotation.rect.x, annotation.rect.y, annotation.rect.width, annotation.rect.height);
      break;
    case 'pen':
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.width;
      strokePath(ctx, annotation.points);
      break;
    case 'highlight':
      ctx.globalAlpha = 0.38;
      ctx.lineCap = 'square';
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.width;
      strokePath(ctx, annotation.points);
      break;
    case 'text':
      ctx.font = textFont(annotation.size);
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, annotation.size / 9);
      ctx.strokeStyle = annotation.color === '#111827' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.35)';
      annotation.text.split('\n').forEach((line, index) => {
        const y = annotation.at.y + index * annotation.size * 1.25;
        ctx.strokeText(line, annotation.at.x, y);
        ctx.fillStyle = annotation.color;
        ctx.fillText(line, annotation.at.x, y);
      });
      break;
    case 'blur':
      pixelate(ctx, annotation.rect, annotation.block);
      break;
  }
  ctx.restore();
}

/** Paint image + annotations; the canvas is sized to the crop (or the whole image). */
export function renderDoc(canvas: HTMLCanvasElement, image: CanvasImageSource, imageWidth: number, imageHeight: number, doc: EditorDoc, draft: Annotation | null): void {
  const crop = doc.crop ?? { x: 0, y: 0, width: imageWidth, height: imageHeight };
  if (canvas.width !== crop.width) canvas.width = crop.width;
  if (canvas.height !== crop.height) canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(1, 0, 0, 1, -crop.x, -crop.y);
  ctx.drawImage(image, 0, 0);
  for (const annotation of doc.annotations) drawAnnotation(ctx, annotation);
  if (draft) drawAnnotation(ctx, draft);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
