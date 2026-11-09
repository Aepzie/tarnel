import { useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { cn } from '@/lib/utils';
import { clamp } from './eq-math';

const SWEEP = 270;
const START = -135;
/** Pixels of vertical drag for the full range (Shift: 4× finer). */
const DRAG_RANGE_PX = 160;

interface KnobProps {
  value: number;
  min: number;
  max: number;
  /** Value restored on double-click / Delete. */
  defaultValue: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
  /** Spoken + shown value. */
  format: (value: number) => string;
  /** Logarithmic travel (frequencies). */
  log?: boolean;
  /** Arc grows from the centre (balance). */
  bipolar?: boolean;
  size?: number;
  className?: string;
}

function polar(cx: number, cy: number, radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
}

function arc(cx: number, cy: number, radius: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, radius, from);
  const [x2, y2] = polar(cx, cy, radius, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * Rotary control: drag up/down (or scroll), arrow keys, double-click to reset. Drawn as a 270° arc
 * with the value in the Space accent and a pointer notch on the cap.
 */
export function Knob({ value, min, max, defaultValue, step, onChange, label, format, log = false, bipolar = false, size = 40, className }: KnobProps) {
  const drag = useRef<{ y: number; unit: number } | null>(null);
  const toUnit = (input: number): number => (log ? Math.log(input / min) / Math.log(max / min) : (input - min) / (max - min));
  const fromUnit = (unit: number): number => {
    const raw = log ? min * (max / min) ** unit : min + unit * (max - min);
    return clamp(Math.round(raw / step) * step, min, max);
  };
  const unit = clamp(toUnit(value), 0, 1);
  const angle = START + unit * SWEEP;
  const center = size / 2;
  const radius = size / 2 - 3;
  const from = bipolar ? 0 : START;
  const nudge = (deltaUnit: number): void => onChange(fromUnit(clamp(unit + deltaUnit, 0, 1)));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, unit };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    const scale = event.shiftKey ? DRAG_RANGE_PX * 4 : DRAG_RANGE_PX;
    onChange(fromUnit(clamp(drag.current.unit + (drag.current.y - event.clientY) / scale, 0, 1)));
  };
  const onPointerUp = (): void => {
    drag.current = null;
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (document.activeElement !== event.currentTarget) return;
    nudge(event.deltaY < 0 ? 0.02 : -0.02);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const stepUnit = log ? (event.shiftKey ? 0.01 : 0.04) : (step / (max - min)) * (event.shiftKey ? 1 : 2);
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') nudge(stepUnit);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') nudge(-stepUnit);
    else if (event.key === 'PageUp') nudge(0.2);
    else if (event.key === 'PageDown') nudge(-0.2);
    else if (event.key === 'Home') onChange(min);
    else if (event.key === 'End') onChange(max);
    else if (event.key === 'Delete' || event.key === 'Backspace') onChange(defaultValue);
    else return;
    event.preventDefault();
  };

  const [dotX, dotY] = polar(center, center, radius - 7, angle);
  const active = Math.abs(angle - from) > 0.5;

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuetext={format(value)}
      title={`${label}: ${format(value)}`}
      className={cn('group/knob relative shrink-0 cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      style={{ width: size, height: size }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onChange(defaultValue)}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <path d={arc(center, center, radius, START, START + SWEEP)} fill="none" strokeWidth={2.5} strokeLinecap="round" className="stroke-foreground/10" />
        {active && (
          <path
            d={arc(center, center, radius, Math.min(from, angle), Math.max(from, angle))}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            className="stroke-space drop-shadow-[0_0_4px_color-mix(in_oklab,var(--accent-space)_60%,transparent)]"
          />
        )}
        <circle
          cx={center}
          cy={center}
          r={radius - 4.5}
          className="fill-zinc-800 stroke-white/[0.08] light:fill-white light:stroke-black/10"
          strokeWidth={1}
        />
        <circle cx={dotX} cy={dotY} r={1.75} className={cn(active ? 'fill-space' : 'fill-foreground/60')} />
      </svg>
    </div>
  );
}
