import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, Check, Copy, Crop, Download, EyeOff, Highlighter, Pencil, Redo2, Square, Type, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { rectFromPoints, type PixelRect } from '@shared/screenshot';
import type { UICommand } from '@shared/types';
import { useCommand } from '@/hooks/browser';
import { cn } from '@/lib/utils';
import { GLASS_SURFACE } from '../spaces/surface';
import { COLORS, renderDoc, strokeFor, textFont, type Annotation, type EditorDoc, type Point, type Tool } from './annotations';
import { PILL_BUTTON } from './pill';
import { screenshot, type EditorImage } from './screenshot-store';

const TOOLS: { tool: Tool; label: string; icon: LucideIcon }[] = [
  { tool: 'crop', label: 'Crop', icon: Crop },
  { tool: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { tool: 'rect', label: 'Rectangle', icon: Square },
  { tool: 'pen', label: 'Pen', icon: Pencil },
  { tool: 'text', label: 'Text', icon: Type },
  { tool: 'highlight', label: 'Highlighter', icon: Highlighter },
  { tool: 'blur', label: 'Blur (pixelate)', icon: EyeOff },
];

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const clampZoom = (value: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

interface TextDraft {
  at: Point;
  value: string;
}

type Flash = 'copied' | 'saved' | null;

function useLoadedImage(dataUrl: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const element = new Image();
    element.onload = () => setImage(element);
    element.src = dataUrl;
  }, [dataUrl]);
  return image;
}

/** Screenshot editor: crop, arrow, rectangle, pen, text, highlighter, pixelate; undo/redo, zoom; copy / save. */
export function ScreenshotEditor({ image }: { image: EditorImage }) {
  const source = useLoadedImage(image.dataUrl);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<EditorDoc[]>([{ annotations: [], crop: null }]);
  const [index, setIndex] = useState(0);
  const doc = history[index] ?? { annotations: [], crop: null };
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [cropDraft, setCropDraft] = useState<PixelRect | null>(null);
  const [text, setText] = useState<TextDraft | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const dragStart = useRef<Point | null>(null);

  const view = doc.crop ?? { x: 0, y: 0, width: image.width, height: image.height };
  const stroke = useMemo(() => strokeFor(image.width, image.height), [image.width, image.height]);
  const textSize = stroke * 6;

  useEffect(() => rootRef.current?.focus(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    const frame = requestAnimationFrame(() => renderDoc(canvas, source, image.width, image.height, doc, draft));
    return () => cancelAnimationFrame(frame);
  }, [source, doc, draft, image.width, image.height]);

  useLayoutEffect(() => {
    if (!fit) return;
    const box = scrollRef.current;
    if (!box) return;
    const update = (): void => {
      const available = { width: box.clientWidth - 48, height: box.clientHeight - 48 };
      const byWidth = available.width / view.width;
      // Long full-page captures fit the width and scroll; everything else fits entirely.
      const tall = view.height * byWidth > available.height * 2.5;
      setZoom(clampZoom(Math.min(1, tall ? byWidth : Math.min(byWidth, available.height / view.height))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [fit, view.width, view.height]);

  const commit = useCallback(
    (next: EditorDoc): void => {
      setHistory((prev) => [...prev.slice(0, index + 1), next]);
      setIndex((prev) => prev + 1);
    },
    [index],
  );
  const canUndo = index > 0;
  const canRedo = index < history.length - 1;
  const undo = useCallback(() => setIndex((prev) => Math.max(0, prev - 1)), []);
  const redo = useCallback(() => setIndex((prev) => Math.min(history.length - 1, prev + 1)), [history.length]);

  const toImage = (event: { clientX: number; clientY: number }): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - box.left) / box.width) * view.width + view.x),
      y: Math.round(((event.clientY - box.top) / box.height) * view.height + view.y),
    };
  };

  const commitText = useCallback((): void => {
    if (!text) return;
    const value = text.value.replace(/\s+$/, '');
    setText(null);
    if (!value) return;
    commit({ ...doc, annotations: [...doc.annotations, { kind: 'text', color, size: textSize, at: text.at, text: value }] });
  }, [text, commit, doc, color, textSize]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;
    const at = toImage(event);
    if (tool === 'text') {
      event.preventDefault();
      if (text) commitText();
      setText({ at, value: '' });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = at;
    if (tool === 'pen' || tool === 'highlight') {
      setDraft({ kind: tool, color, width: tool === 'highlight' ? stroke * 5 : stroke, points: [at] });
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const start = dragStart.current;
    if (!start) return;
    const at = toImage(event);
    switch (tool) {
      case 'pen':
      case 'highlight':
        setDraft((prev) => (prev && (prev.kind === 'pen' || prev.kind === 'highlight') ? { ...prev, points: [...prev.points, at] } : prev));
        break;
      case 'arrow':
        setDraft({ kind: 'arrow', color, width: stroke, from: start, to: at });
        break;
      case 'rect':
        setDraft({ kind: 'rect', color, width: stroke, rect: rectFromPoints(start.x, start.y, at.x, at.y) });
        break;
      case 'blur':
        setDraft({ kind: 'blur', block: Math.max(8, stroke * 3), rect: rectFromPoints(start.x, start.y, at.x, at.y) });
        break;
      case 'crop':
        setCropDraft(rectFromPoints(start.x, start.y, at.x, at.y));
        break;
      default:
        break;
    }
  };

  const onPointerUp = (): void => {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (tool === 'crop') {
      const area = cropDraft ? intersect(cropDraft, view) : null;
      setCropDraft(null);
      if (area && area.width >= 4 && area.height >= 4) {
        commit({ ...doc, crop: area });
        setFit(true);
      }
      return;
    }
    const finished = draft;
    setDraft(null);
    if (!finished || !meaningful(finished)) return;
    commit({ ...doc, annotations: [...doc.annotations, finished] });
  };

  const exportPng = (): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return null;
    renderDoc(canvas, source, image.width, image.height, doc, null);
    return canvas.toDataURL('image/png');
  };

  const showFlash = (kind: Flash): void => {
    setFlash(kind);
    window.setTimeout(() => setFlash((current) => (current === kind ? null : current)), 1600);
  };

  const copy = (): void => {
    const dataUrl = exportPng();
    if (!dataUrl) return;
    setFailure(null);
    window.vela.screenshot
      .copy(dataUrl)
      .then(() => showFlash('copied'))
      .catch(() => setFailure('Could not copy'));
  };

  const save = (format: 'png' | 'jpeg'): void => {
    const dataUrl = exportPng();
    if (!dataUrl) return;
    setFailure(null);
    window.vela.screenshot
      .save(dataUrl, format)
      .then((result) => result.saved && showFlash('saved'))
      .catch(() => setFailure('Could not save'));
  };

  const zoomBy = (factor: number): void => {
    setFit(false);
    setZoom((prev) => clampZoom(Math.round(prev * factor * 100) / 100));
  };

  const onCommand = useCallback(
    (command: UICommand): void => {
      if (command !== 'escape') return;
      if (text) setText(null);
      else screenshot.close();
    },
    [text],
  );
  useCommand(onCommand);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.target instanceof HTMLTextAreaElement) return;
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      redo();
    } else if (key === 'c') {
      event.preventDefault();
      copy();
    } else if (key === 's') {
      event.preventDefault();
      save('png');
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey) return;
    zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  };

  const cssWidth = Math.max(1, Math.round(view.width * zoom));
  const cssHeight = Math.max(1, Math.round(view.height * zoom));

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Screenshot editor"
      onKeyDown={onKeyDown}
      className="no-drag fixed inset-0 z-[90] flex flex-col bg-background outline-none select-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-3">
        <div className="flex min-w-0 flex-col pl-1">
          <span className="truncate text-[13px] font-semibold tracking-tight">Screenshot</span>
          <span className="truncate text-[11px] text-muted-foreground tabular-nums">
            {view.width} × {view.height}
            {image.truncated && ' · long page cut at 16,000 px'}
          </span>
        </div>

        <div className={cn(GLASS_SURFACE, 'flex items-center gap-0.5 rounded-2xl p-1.5')} role="toolbar" aria-label="Tools">
          {TOOLS.map(({ tool: id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={tool === id}
              onClick={() => {
                if (text) commitText();
                setTool(id);
              }}
              className={cn(PILL_BUTTON, 'w-8 justify-center px-0', tool === id && 'bg-accent text-foreground')}
            >
              <Icon className="size-4" strokeWidth={1.75} />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Colour ${swatch}`}
              aria-pressed={color === swatch}
              onClick={() => setColor(swatch)}
              className="grid size-7 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  'size-4 rounded-full ring-1 ring-black/15 transition-transform duration-150 dark:ring-white/20',
                  color === swatch && 'scale-110 ring-2 ring-foreground dark:ring-foreground',
                )}
                style={{ backgroundColor: swatch }}
              />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={undo} className={cn(PILL_BUTTON, 'w-8 justify-center px-0')}>
            <Undo2 className="size-4" strokeWidth={1.75} />
          </button>
          <button type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={redo} className={cn(PILL_BUTTON, 'w-8 justify-center px-0')}>
            <Redo2 className="size-4" strokeWidth={1.75} />
          </button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)} className={cn(PILL_BUTTON, 'w-8 justify-center px-0')}>
            <ZoomOut className="size-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title={fit ? 'Actual size' : 'Fit to window'}
            onClick={() => {
              if (fit) {
                setFit(false);
                setZoom(1);
              } else setFit(true);
            }}
            className={cn(PILL_BUTTON, 'w-14 justify-center px-0 tabular-nums')}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(1.25)} className={cn(PILL_BUTTON, 'w-8 justify-center px-0')}>
            <ZoomIn className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className={cn(GLASS_SURFACE, 'flex items-center gap-0.5 rounded-2xl p-1.5')}>
          {failure && <span className="px-2 text-[12px] text-destructive">{failure}</span>}
          <button type="button" title="Copy to clipboard (Ctrl+C)" onClick={copy} disabled={!source} className={PILL_BUTTON}>
            {flash === 'copied' ? <Check className="size-4" strokeWidth={1.75} /> : <Copy className="size-4" strokeWidth={1.75} />}
            {flash === 'copied' ? 'Copied' : 'Copy'}
          </button>
          <button type="button" title="Save as PNG (Ctrl+S)" onClick={() => save('png')} disabled={!source} className={PILL_BUTTON}>
            {flash === 'saved' ? <Check className="size-4" strokeWidth={1.75} /> : <Download className="size-4" strokeWidth={1.75} />}
            {flash === 'saved' ? 'Saved' : 'Save'}
          </button>
          <button type="button" title="Save as JPEG" onClick={() => save('jpeg')} disabled={!source} className={PILL_BUTTON}>
            JPEG
          </button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" title="Close (Esc)" aria-label="Close editor" onClick={screenshot.close} className={cn(PILL_BUTTON, 'w-8 justify-center px-0')}>
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" onWheel={onWheel}>
        <div className="flex min-h-full min-w-full items-center justify-center p-6" style={{ width: cssWidth + 48, height: cssHeight + 48 }}>
          <div className="relative shrink-0 shadow-[0_0_0_1px_var(--island-ring),0_12px_40px_-16px_rgb(0_0_0/0.5)]" style={{ width: cssWidth, height: cssHeight }}>
            <canvas
              ref={canvasRef}
              className={cn('block size-full', tool === 'text' ? 'cursor-text' : 'cursor-crosshair')}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                dragStart.current = null;
                setDraft(null);
                setCropDraft(null);
              }}
            />
            {cropDraft && (
              <div
                className="pointer-events-none absolute outline outline-1 outline-white shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]"
                style={{
                  left: (cropDraft.x - view.x) * zoom,
                  top: (cropDraft.y - view.y) * zoom,
                  width: cropDraft.width * zoom,
                  height: cropDraft.height * zoom,
                }}
              />
            )}
            {text && (
              <textarea
                autoFocus
                rows={1}
                value={text.value}
                placeholder="Type…"
                onChange={(event) => setText({ ...text, value: event.target.value })}
                onBlur={commitText}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    commitText();
                  }
                }}
                className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 leading-[1.25] outline outline-1 outline-dashed outline-white/70 placeholder:text-white/50"
                style={{
                  left: (text.at.x - view.x) * zoom,
                  top: (text.at.y - view.y) * zoom,
                  font: textFont(textSize * zoom),
                  color,
                  width: Math.max(120, (view.width - (text.at.x - view.x)) * zoom - 8),
                  height: (text.value.split('\n').length * 1.25 * textSize + 4) * zoom,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function intersect(a: PixelRect, b: PixelRect): PixelRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function meaningful(annotation: Annotation): boolean {
  switch (annotation.kind) {
    case 'arrow':
      return Math.hypot(annotation.to.x - annotation.from.x, annotation.to.y - annotation.from.y) >= 4;
    case 'rect':
    case 'blur':
      return annotation.rect.width >= 3 && annotation.rect.height >= 3;
    default:
      return true;
  }
}
