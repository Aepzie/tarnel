import { lazy, Suspense, useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Monitor, Scan, ScrollText, X } from 'lucide-react';
import { rectFromPoints, scaleRectInto, type PixelRect, type ScreenshotCapture } from '@shared/screenshot';
import type { UICommand } from '@shared/types';
import { useCommand } from '@/hooks/browser';
import { useOverlay } from '@/hooks/overlay';
import { cn } from '@/lib/utils';
import { GLASS_SURFACE } from '../spaces/surface';
import { PILL_BUTTON } from './pill';
import { screenshot, useScreenshotError, useScreenshotPhase } from './screenshot-store';

// The editor is only needed after a capture: load it with the first screenshot.
const ScreenshotEditor = lazy(() => import('./ScreenshotEditor').then((module) => ({ default: module.ScreenshotEditor })));

const MIN_AREA = 6;

function cropDataUrl(capture: ScreenshotCapture, area: PixelRect): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = area.width;
      canvas.height = area.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No canvas'));
      ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('Bad image'));
    image.src = capture.dataUrl;
  });
}

interface Drag {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Frozen copy of the page under the chrome: drag an area, or take the visible part / the full page. */
function AreaSelect({ capture }: { capture: ScreenshotCapture }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const error = useScreenshotError();
  const { bounds } = capture;

  const local = (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(box.width, event.clientX - box.left)),
      y: Math.max(0, Math.min(box.height, event.clientY - box.top)),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = local(event);
    setDrag({ ax: x, ay: y, bx: x, by: y });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag) return;
    const { x, y } = local(event);
    setDrag({ ...drag, bx: x, by: y });
  };
  const onPointerUp = (): void => {
    if (!drag) return;
    const rect = rectFromPoints(drag.ax, drag.ay, drag.bx, drag.by);
    setDrag(null);
    if (rect.width < MIN_AREA || rect.height < MIN_AREA) return;
    const area = scaleRectInto(rect, capture.width / bounds.width, capture.width, capture.height);
    if (area.width < 1 || area.height < 1) return;
    setBusy(true);
    cropDataUrl(capture, area)
      .then((dataUrl) => screenshot.edit({ dataUrl, width: area.width, height: area.height, title: capture.title, truncated: false }))
      .catch(() => setBusy(false));
  };

  const selection = drag ? rectFromPoints(drag.ax, drag.ay, drag.bx, drag.by) : null;

  return (
    <div className="no-drag fixed inset-0 z-[90] select-none" role="dialog" aria-label="Take a screenshot">
      <div className="absolute inset-0 bg-black/25" />
      <div
        className="absolute cursor-crosshair overflow-hidden rounded-xl"
        style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <img src={capture.dataUrl} alt="" draggable={false} className="pointer-events-none size-full" />
        {selection ? (
          <div
            className="pointer-events-none absolute rounded-[2px] outline outline-1 outline-white/90 shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]"
            style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}
          >
            <span className="absolute -bottom-6 left-0 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] text-white tabular-nums">
              {Math.round((selection.width * capture.width) / bounds.width)} × {Math.round((selection.height * capture.height) / bounds.height)}
            </span>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 bg-black/30" />
        )}
      </div>
      <div
        className={cn(GLASS_SURFACE, 'absolute flex -translate-x-1/2 items-center gap-1 rounded-2xl p-1.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200')}
        style={{ left: bounds.x + bounds.width / 2, top: bounds.y + 12 }}
      >
        <span className={cn(PILL_BUTTON, 'pointer-events-none bg-accent text-foreground')}>
          <Scan className="size-4" strokeWidth={1.75} />
          Drag to select an area
        </span>
        <button type="button" className={PILL_BUTTON} disabled={busy} onClick={screenshot.visible}>
          <Monitor className="size-4" strokeWidth={1.75} />
          Visible part
        </button>
        <button type="button" className={PILL_BUTTON} disabled={busy} onClick={() => void screenshot.fullPage()}>
          <ScrollText className="size-4" strokeWidth={1.75} />
          Full page
        </button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <button type="button" aria-label="Cancel screenshot" className={cn(PILL_BUTTON, 'px-2')} onClick={screenshot.close}>
          <X className="size-4" strokeWidth={1.75} />
        </button>
        {error && <span className="px-2 text-[12px] text-destructive">{error}</span>}
      </div>
    </div>
  );
}

function ErrorToast({ message }: { message: string }) {
  const [shown, setShown] = useState(true);
  useOverlay(shown);
  useEffect(() => {
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), 2600);
    return () => window.clearTimeout(timer);
  }, [message]);
  if (!shown) return null;
  return (
    <div role="status" className={cn(GLASS_SURFACE, 'no-drag fixed top-16 left-1/2 z-[90] -translate-x-1/2 rounded-xl px-3 py-2 text-[12.5px]')}>
      Screenshot failed: {message}
    </div>
  );
}

/** Screenshot flow root: area selection over the page, then the (lazy) editor. Holds the overlay while open. */
export function ScreenshotLayer() {
  const phase = useScreenshotPhase();
  const error = useScreenshotError();
  useOverlay(phase.kind === 'select' || phase.kind === 'edit');

  const onCommand = useCallback((command: UICommand): void => {
    if (command === 'screenshot') {
      if (screenshot.get().kind === 'idle') void screenshot.start();
      return;
    }
    if (command === 'escape' && screenshot.get().kind === 'select') screenshot.close();
  }, []);
  useCommand(onCommand);

  return (
    <>
      {phase.kind === 'select' && <AreaSelect capture={phase.capture} />}
      {phase.kind === 'idle' && error && <ErrorToast message={error} />}
      {phase.kind === 'edit' && (
        <Suspense fallback={null}>
          <ScreenshotEditor image={phase.image} />
        </Suspense>
      )}
    </>
  );
}
