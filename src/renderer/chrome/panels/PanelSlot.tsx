import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clampPanelWidth, PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, type PanelInfo } from '@shared/panels';
import { settle, vela } from '@/lib/vela';

/**
 * Transparent placeholder where main places the open panel's view (same idea as Viewport). It takes
 * the panel's width out of the flex row, so the page viewport shrinks by the same amount; its rect
 * is reported every frame it changes (resize drags are live).
 */
export function PanelSlot({ panel }: { panel: PanelInfo }) {
  const ref = useRef<HTMLDivElement>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const width = liveWidth ?? panel.width;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let last = '';
    const tick = (): void => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
      if (key === last) return;
      last = key;
      settle(vela().panels.setBounds(rect));
    };
    const report = (): void => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    observer.observe(document.body);
    window.addEventListener('resize', report);
    report();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [panel.id]);

  return (
    <div ref={ref} aria-label={panel.name} className="relative shrink-0 rounded-xl bg-transparent ring-1 ring-island-ring" style={{ width }}>
      <ResizeHandle id={panel.id} width={panel.width} onLive={setLiveWidth} />
    </div>
  );
}

/** Drag the slot's left edge to resize (persisted per panel on release); double-click resets. */
function ResizeHandle({ id, width, onLive }: { id: string; width: number; onLive: (width: number | null) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef(width);

  const commit = (next: number): void => {
    void vela()
      .panels.update(id, { width: next })
      .catch(() => undefined)
      .finally(() => onLive(null));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    latest.current = width;
    onLive(width);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!start.current) return;
    latest.current = clampPanelWidth(start.current.width - (event.clientX - start.current.x));
    onLive(latest.current);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!start.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    start.current = null;
    commit(latest.current);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={PANEL_MAX_WIDTH}
      aria-valuenow={width}
      className="group/resize no-drag absolute inset-y-4 -left-2 w-2 cursor-col-resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => commit(PANEL_DEFAULT_WIDTH)}
    >
      <span className="absolute inset-y-0 left-1 w-px rounded-full bg-space opacity-0 transition-opacity duration-150 group-hover/resize:opacity-60 group-active/resize:opacity-90" />
    </div>
  );
}
