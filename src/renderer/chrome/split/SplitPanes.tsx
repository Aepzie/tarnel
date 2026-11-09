import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useReducedMotion } from 'motion/react';
import type { ContentBounds, TabSplit } from '@shared/types';
import { SPLIT_DEFAULT_RATIO, SPLIT_GAP, sanitizeRatio, splitGeometry } from '@shared/split-layout';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { PaneToolbar } from './PaneToolbar';
import { useElementSize } from './use-element-size';

type Ratios = { x: number; y: number };
type Axis = 'x' | 'y';

const KEY_STEP = 0.02;

const rectStyle = (rect: ContentBounds): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });

/**
 * Chrome side of the split on screen. Main places the page views; this draws what lives in the gaps
 * between them: each pane's hairline frame, the accent focus ring around the focused pane, the
 * draggable dividers and the hover toolbar. Geometry comes from the same `splitGeometry` main uses.
 */
export function SplitPanes({ split, focusedId }: { split: TabSplit; focusedId: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const reduced = !!useReducedMotion();
  const [draft, setDraft] = useState<Ratios | null>(null);

  useEffect(() => setDraft(null), [split.id, split.ratioX, split.ratioY]);

  const ratios = draft ?? { x: split.ratioX, y: split.ratioY };
  const count = split.tabIds.length;
  const geometry = size ? splitGeometry({ x: 0, y: 0, ...size }, count, ratios.x, ratios.y, true) : null;

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {geometry &&
        split.tabIds.map((tabId, index) => {
          const pane = geometry.panes[index];
          if (!pane) return null;
          const focused = tabId === focusedId;
          return (
            <div
              key={tabId}
              aria-hidden="true"
              className={cn(
                'absolute rounded-xl',
                reduced ? 'transition-none' : 'transition-[box-shadow] duration-200 ease-out',
                focused
                  ? 'shadow-[0_0_0_1.5px_color-mix(in_oklab,var(--accent-space)_60%,transparent),0_0_16px_-2px_color-mix(in_oklab,var(--accent-space)_32%,transparent)]'
                  : 'shadow-[0_0_0_1px_var(--island-ring)]',
              )}
              style={rectStyle(pane)}
            />
          );
        })}
      {geometry && size && (
        <>
          {geometry.rowGap && (
            <Divider axis="y" rect={geometry.rowGap} split={split} ratios={ratios} span={size.height} onDraft={setDraft} />
          )}
          <Divider axis="x" rect={geometry.columnGap} split={split} ratios={ratios} span={size.width} onDraft={setDraft} />
          <PaneToolbar split={split} panes={geometry.panes} containerRef={ref} />
        </>
      )}
    </div>
  );
}

interface DividerProps {
  axis: Axis;
  rect: ContentBounds;
  split: TabSplit;
  ratios: Ratios;
  /** Container size along the axis (px). */
  span: number;
  onDraft: (ratios: Ratios | null) => void;
}

/**
 * Drag to resize (live: main re-places the views each frame, nothing is emitted), release to persist,
 * double-click to reset to 50/50, arrow keys when focused.
 */
function Divider({ axis, rect, split, ratios, span, onDraft }: DividerProps) {
  const reduced = !!useReducedMotion();
  const [dragging, setDragging] = useState(false);
  const origin = useRef(0);
  const latest = useRef(ratios);
  const frame = useRef(0);
  latest.current = dragging ? latest.current : ratios;

  const send = (next: Ratios, commit: boolean): void => {
    settle(vela().split.resize(split.id, next.x, next.y, commit));
  };

  const update = (next: Ratios): void => {
    latest.current = next;
    onDraft(next);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      send(latest.current, false);
    });
  };

  const ratioAt = (client: number): number => sanitizeRatio((client - origin.current - SPLIT_GAP / 2) / Math.max(1, span - SPLIT_GAP));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = event.currentTarget.parentElement?.getBoundingClientRect();
    origin.current = axis === 'x' ? (box?.left ?? 0) : (box?.top ?? 0);
    latest.current = ratios;
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    const value = ratioAt(axis === 'x' ? event.clientX : event.clientY);
    update(axis === 'x' ? { ...latest.current, x: value } : { ...latest.current, y: value });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setDragging(false);
    send(latest.current, true);
  };

  const commitValue = (value: number): void => {
    const next = axis === 'x' ? { ...ratios, x: sanitizeRatio(value) } : { ...ratios, y: sanitizeRatio(value) };
    onDraft(next);
    send(next, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = axis === 'x' ? ratios.x : ratios.y;
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (event.key === back) commitValue(current - KEY_STEP);
    else if (event.key === forward) commitValue(current + KEY_STEP);
    else if (event.key === 'Home' || event.key === 'Enter') commitValue(SPLIT_DEFAULT_RATIO);
    else return;
    event.preventDefault();
  };

  const vertical = axis === 'x';
  const value = Math.round((vertical ? ratios.x : ratios.y) * 100);

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={vertical ? 'Resize split columns' : 'Resize split rows'}
      aria-valuemin={10}
      aria-valuemax={90}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => commitValue(SPLIT_DEFAULT_RATIO)}
      onKeyDown={onKeyDown}
      className={cn(
        'group/divider no-drag pointer-events-auto absolute z-10 flex items-center justify-center outline-none',
        vertical ? 'cursor-col-resize' : 'cursor-row-resize',
      )}
      style={rectStyle(rect)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'rounded-full bg-zinc-400/0 group-hover/divider:bg-zinc-400/45 group-focus-visible/divider:bg-[var(--ring)] light:group-hover/divider:bg-zinc-500/45',
          vertical ? 'h-10 w-[3px] group-hover/divider:h-14' : 'h-[3px] w-10 group-hover/divider:w-14',
          dragging && (vertical ? 'h-14 bg-space/80 group-hover/divider:bg-space/80' : 'w-14 bg-space/80 group-hover/divider:bg-space/80'),
          reduced ? 'transition-none' : 'transition-[background-color,height,width] duration-150 ease-out',
        )}
      />
    </div>
  );
}
