import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { VOLUME_RANGE } from '@shared/audio-mixer';
import { cn } from '@/lib/utils';
import { clamp } from './eq-math';

const DETENT = 1;
/** Snap window around 100 % while dragging. */
const DETENT_SNAP = 0.04;
const TICKS = [2, 1.5, 1, 0.5, 0];

export const formatVolume = (volume: number): string => `${Math.round(volume * 100)}%`;

interface FaderProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  muted?: boolean;
  className?: string;
}

/**
 * Vertical channel fader, 0–200 % (linear). Grabbing the cap drags relatively, clicking the track
 * jumps; 100 % is a soft detent; double-click resets to 100 %. Arrow keys ±5 % (Shift ±1 %),
 * PageUp/PageDown ±25 %, Home/End min/max.
 */
export function Fader({ value, onChange, label, muted = false, className }: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ offset: number } | null>(null);
  const unit = (value - VOLUME_RANGE.min) / (VOLUME_RANGE.max - VOLUME_RANGE.min);

  const valueAt = (clientY: number, offset: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return value;
    const position = clamp(1 - (clientY - offset - rect.top) / rect.height, 0, 1);
    const next = VOLUME_RANGE.min + position * (VOLUME_RANGE.max - VOLUME_RANGE.min);
    if (Math.abs(next - DETENT) < DETENT_SNAP) return DETENT;
    return Math.round(next * 100) / 100;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const onCap = (event.target as HTMLElement).closest('[data-fader-cap]');
    const rect = trackRef.current?.getBoundingClientRect();
    const capCenter = rect ? rect.top + (1 - unit) * rect.height : event.clientY;
    grab.current = { offset: onCap ? event.clientY - capCenter : 0 };
    if (!onCap) onChange(valueAt(event.clientY, 0));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!grab.current) return;
    onChange(valueAt(event.clientY, grab.current.offset));
  };

  const onPointerUp = (): void => {
    grab.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 0.01 : 0.05;
    const deltas: Record<string, number> = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
      PageUp: 0.25,
      PageDown: -0.25,
    };
    let next: number | null = null;
    if (event.key in deltas) next = value + deltas[event.key]!;
    else if (event.key === 'Home') next = VOLUME_RANGE.min;
    else if (event.key === 'End') next = VOLUME_RANGE.max;
    if (next === null) return;
    event.preventDefault();
    onChange(Math.round(clamp(next, VOLUME_RANGE.min, VOLUME_RANGE.max) * 100) / 100);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={VOLUME_RANGE.min * 100}
      aria-valuemax={VOLUME_RANGE.max * 100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`${formatVolume(value)}${muted ? ', muted' : ''}`}
      className={cn('group/fader relative w-8 cursor-ns-resize touch-none rounded-md outline-none', className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onChange(DETENT)}
      onKeyDown={onKeyDown}
    >
      <div ref={trackRef} className="absolute inset-x-0 top-[7px] bottom-[7px]">
        {TICKS.map((tick) => (
          <span
            key={tick}
            aria-hidden
            className={cn(
              'absolute left-0 h-px w-[5px] -translate-y-1/2 bg-foreground/15',
              tick === DETENT && 'w-[7px] bg-foreground/35',
            )}
            style={{ top: `${(1 - tick / VOLUME_RANGE.max) * 100}%` }}
          />
        ))}
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-foreground/[0.08] shadow-[inset_0_1px_1px_rgb(0_0_0/0.35)] light:shadow-none" />
        <span
          aria-hidden
          className={cn(
            'absolute bottom-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-[background-color] duration-200',
            muted ? 'bg-foreground/25' : 'bg-space',
          )}
          style={{ height: `${unit * 100}%` }}
        />
        <span
          data-fader-cap
          aria-hidden
          className={cn(
            'absolute left-1/2 grid h-[14px] w-[26px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[5px]',
            'bg-zinc-200 shadow-[0_1px_0_rgb(255_255_255/0.6)_inset,0_2px_6px_-1px_rgb(0_0_0/0.6),0_0_0_0.5px_rgb(0_0_0/0.5)]',
            'light:bg-white light:shadow-[0_1px_3px_rgb(0_0_0/0.25),0_0_0_1px_rgb(0_0_0/0.1)]',
            'transition-transform duration-150 group-active/fader:scale-[1.06] group-focus-visible/fader:ring-2 group-focus-visible/fader:ring-ring',
          )}
          style={{ top: `${(1 - unit) * 100}%` }}
        >
          <span className={cn('h-[2px] w-3.5 rounded-full', muted ? 'bg-zinc-400' : 'bg-space')} />
        </span>
      </div>
    </div>
  );
}
