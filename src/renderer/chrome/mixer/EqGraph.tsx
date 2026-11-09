import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useReducedMotion } from 'motion/react';
import { EQ_FREQUENCIES, EQ_GAIN_RANGE, type TabAudioSettings } from '@shared/audio-mixer';
import { cn } from '@/lib/utils';
import { useBoxSize } from './use-box-size';
import { clamp, filtersOf, formatDb, formatHz, freqToUnit, responseDb, sampleFrequencies } from './eq-math';
import { levelOf, onFrame, themeColors } from './levels';

const PAD = { left: 28, right: 10, top: 12, bottom: 20 };
/** Visible dB range (the grid labels stop at ±12; the summed curve may overshoot a little). */
const VIEW_DB = 15;
const GRID_DB = [12, 6, 0, -6, -12];
const CURVE_POINTS = 180;
const FREQS = sampleFrequencies(CURVE_POINTS);
const SPECTRUM_BINS = 16;
const SPECTRUM_RISE = 18;
const SPECTRUM_FALL = 5;

interface EqGraphProps {
  tabId: number;
  settings: TabAudioSettings;
  onBand: (index: number, gain: number) => void;
  /** Spectrum available for this tab (routing 'full'). */
  live: boolean;
}

const snapGain = (gain: number): number => {
  const rounded = Math.round(gain * 2) / 2;
  return Math.abs(rounded) < 0.5 ? 0 : clamp(rounded, EQ_GAIN_RANGE.min, EQ_GAIN_RANGE.max);
};

/**
 * 10-band graphic EQ: draggable band handles on the summed biquad response, live 16-bin spectrum
 * behind it (canvas, rAF), ±12 dB grid and Hz axis. Arrow Up/Down nudge the focused band
 * (Shift: 0.5 dB), Left/Right move between bands, Delete resets a band, double-click too.
 */
export function EqGraph({ tabId, settings, onBand, live }: EqGraphProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRefs = useRef<(SVGGElement | null)[]>([]);
  const size = useBoxSize(boxRef);
  const reduce = !!useReducedMotion();
  const [hot, setHot] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const grab = useRef<{ index: number; offset: number } | null>(null);

  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = Math.max(1, height - PAD.top - PAD.bottom);
  const xOf = (frequency: number): number => PAD.left + freqToUnit(frequency) * plotW;
  const yOf = (gain: number): number => PAD.top + (1 - (clamp(gain, -VIEW_DB, VIEW_DB) + VIEW_DB) / (2 * VIEW_DB)) * plotH;
  const gainAt = (clientY: number): number => {
    const top = boxRef.current?.getBoundingClientRect().top ?? 0;
    const unit = 1 - (clientY - top - PAD.top) / plotH;
    return snapGain(unit * 2 * VIEW_DB - VIEW_DB);
  };

  const { curve, fill, ghost } = useMemo(() => {
    if (!width) return { curve: '', fill: '', ghost: '' };
    const toPath = (filters: ReturnType<typeof filtersOf>): string =>
      FREQS.map((frequency, index) => `${index ? 'L' : 'M'}${xOf(frequency).toFixed(1)} ${yOf(responseDb(filters, frequency)).toFixed(1)}`).join(' ');
    const line = toPath(filtersOf(settings));
    const zero = yOf(0).toFixed(1);
    const area = `${line} L${(PAD.left + plotW).toFixed(1)} ${zero} L${PAD.left} ${zero} Z`;
    const preview = settings.eqEnabled ? '' : toPath(filtersOf({ ...settings, eqEnabled: true }));
    return { curve: line, fill: area, ghost: preview };
  }, [settings.eqEnabled, settings.bands, settings.bassBoost.gain, settings.bassBoost.frequency, width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(plotW * ratio);
    canvas.height = Math.round(plotH * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    const bins = new Float32Array(SPECTRUM_BINS);
    let painted = false;
    return onFrame((dt) => {
      const level = live ? levelOf(tabId) : null;
      const spectrum = level?.spectrum ?? [];
      let moving = false;
      for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
        const target = spectrum[bin] ?? 0;
        const rate = target > bins[bin]! ? SPECTRUM_RISE : SPECTRUM_FALL;
        const next = reduce ? target : bins[bin]! + (target - bins[bin]!) * Math.min(1, rate * dt);
        if (Math.abs(next - bins[bin]!) > 0.0005) moving = true;
        bins[bin] = next;
      }
      if (!moving && painted) return;
      painted = true;
      const { accent, light } = themeColors();
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, plotW, plotH);
      const slot = plotW / SPECTRUM_BINS;
      const gap = Math.min(3, slot * 0.18);
      context.fillStyle = accent;
      for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
        const barH = bins[bin]! * plotH * 0.85;
        if (barH < 0.5) continue;
        const x = bin * slot + gap / 2;
        context.globalAlpha = light ? 0.1 : 0.085;
        context.beginPath();
        context.roundRect(x, plotH - barH, slot - gap, barH, [3, 3, 0, 0]);
        context.fill();
        context.globalAlpha = light ? 0.35 : 0.3;
        context.fillRect(x, plotH - barH, slot - gap, 1.25);
      }
      context.globalAlpha = 1;
    });
  }, [tabId, live, width, height, plotW, plotH, reduce]);

  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    const target = (event.target as Element).closest('[data-band]');
    if (!target || event.button !== 0) return;
    event.preventDefault();
    const index = Number(target.getAttribute('data-band'));
    handleRefs.current[index]?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const onHandle = !!(event.target as Element).closest('[data-handle]');
    const top = boxRef.current?.getBoundingClientRect().top ?? 0;
    const offset = onHandle ? event.clientY - top - yOf(settings.bands[index] ?? 0) : 0;
    grab.current = { index, offset };
    setDragging(index);
    if (!onHandle) onBand(index, gainAt(event.clientY));
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (!grab.current) return;
    const next = gainAt(event.clientY - grab.current.offset);
    if (next !== settings.bands[grab.current.index]) onBand(grab.current.index, next);
  };
  const endDrag = (): void => {
    grab.current = null;
    setDragging(null);
  };

  const onKeyDown = (index: number) => (event: KeyboardEvent<SVGGElement>): void => {
    const gain = settings.bands[index] ?? 0;
    const step = event.shiftKey ? 0.5 : 1;
    const focusBand = (next: number): void => handleRefs.current[clamp(next, 0, EQ_FREQUENCIES.length - 1)]?.focus();
    if (event.key === 'ArrowUp') onBand(index, clamp(gain + step, EQ_GAIN_RANGE.min, EQ_GAIN_RANGE.max));
    else if (event.key === 'ArrowDown') onBand(index, clamp(gain - step, EQ_GAIN_RANGE.min, EQ_GAIN_RANGE.max));
    else if (event.key === 'PageUp') onBand(index, clamp(gain + 3, EQ_GAIN_RANGE.min, EQ_GAIN_RANGE.max));
    else if (event.key === 'PageDown') onBand(index, clamp(gain - 3, EQ_GAIN_RANGE.min, EQ_GAIN_RANGE.max));
    else if (event.key === 'ArrowLeft') focusBand(index - 1);
    else if (event.key === 'ArrowRight') focusBand(index + 1);
    else if (event.key === 'Home') focusBand(0);
    else if (event.key === 'End') focusBand(EQ_FREQUENCIES.length - 1);
    else if (event.key === 'Delete' || event.key === 'Backspace' || event.key === '0') onBand(index, 0);
    else return;
    event.preventDefault();
  };

  const columnW = plotW / EQ_FREQUENCIES.length;
  const enabled = settings.eqEnabled;

  return (
    <div ref={boxRef} className="relative h-full w-full select-none">
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute"
        style={{ left: PAD.left, top: PAD.top, width: plotW, height: plotH }}
      />
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="absolute inset-0 overflow-visible"
          role="group"
          aria-label="Equalizer bands"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <defs>
            <clipPath id={`eq-clip-${tabId}`}>
              <rect x={PAD.left} y={PAD.top - 2} width={plotW} height={plotH + 4} />
            </clipPath>
          </defs>
          {GRID_DB.map((gain) => (
            <g key={gain} aria-hidden>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={yOf(gain)}
                y2={yOf(gain)}
                className={gain === 0 ? 'stroke-foreground/[0.16]' : 'stroke-foreground/[0.06]'}
                strokeDasharray={gain === 0 ? undefined : '2 4'}
              />
              <text x={PAD.left - 7} y={yOf(gain)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[9.5px] tabular-nums">
                {gain > 0 ? `+${gain}` : gain}
              </text>
            </g>
          ))}
          {EQ_FREQUENCIES.map((frequency) => (
            <g key={frequency} aria-hidden>
              <line x1={xOf(frequency)} x2={xOf(frequency)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-foreground/[0.045]" />
              <text x={xOf(frequency)} y={height - 5} textAnchor="middle" className="fill-zinc-500 text-[9.5px] tabular-nums">
                {formatHz(frequency)}
              </text>
            </g>
          ))}

          <g clipPath={`url(#eq-clip-${tabId})`} aria-hidden>
            <path d={fill} className="fill-space/[0.09] transition-opacity duration-200" />
            {ghost && <path d={ghost} fill="none" strokeWidth={1.25} strokeDasharray="3 4" className="stroke-foreground/25" />}
            <path
              d={curve}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              className="stroke-space drop-shadow-[0_0_6px_color-mix(in_oklab,var(--accent-space)_55%,transparent)]"
            />
          </g>

          {EQ_FREQUENCIES.map((frequency, index) => {
            const gain = settings.bands[index] ?? 0;
            const cx = xOf(frequency);
            const cy = yOf(gain);
            const lit = hot === index || dragging === index;
            const tipY = cy < 34 ? cy + 12 : cy - 30;
            return (
              <g
                key={frequency}
                ref={(node) => {
                  handleRefs.current[index] = node;
                }}
                data-band={index}
                role="slider"
                tabIndex={0}
                aria-label={`${formatHz(frequency)}Hz band`}
                aria-orientation="vertical"
                aria-valuemin={EQ_GAIN_RANGE.min}
                aria-valuemax={EQ_GAIN_RANGE.max}
                aria-valuenow={gain}
                aria-valuetext={formatDb(gain)}
                className="cursor-ns-resize outline-none"
                onFocus={() => setHot(index)}
                onBlur={() => setHot((current) => (current === index ? null : current))}
                onPointerEnter={() => setHot(index)}
                onPointerLeave={() => setHot((current) => (current === index && dragging === null ? null : current))}
                onDoubleClick={() => onBand(index, 0)}
                onKeyDown={onKeyDown(index)}
              >
                <rect x={cx - columnW / 2} y={PAD.top} width={columnW} height={plotH} fill="transparent" />
                {lit && <rect x={cx - columnW / 2 + 2} y={PAD.top} width={columnW - 4} height={plotH} rx={6} className="fill-foreground/[0.035]" />}
                <circle data-handle cx={cx} cy={cy} r={lit ? 13 : 10} fill="transparent" />
                <circle
                  cx={cx}
                  cy={cy}
                  r={lit ? 6 : 5}
                  strokeWidth={2}
                  className={cn(
                    'pointer-events-none fill-zinc-900 stroke-space transition-[r,opacity] duration-150 light:fill-white',
                    !enabled && 'opacity-50',
                    lit && 'drop-shadow-[0_0_6px_var(--accent-space)]',
                  )}
                />
                {lit && (
                  <g className="pointer-events-none">
                    <rect x={cx - 23} y={tipY} width={46} height={18} rx={9} className="fill-zinc-800 stroke-white/10 light:fill-white light:stroke-black/10" />
                    <text x={cx} y={tipY + 9} dy="0.34em" textAnchor="middle" className="fill-foreground text-[10px] font-medium tabular-nums">
                      {formatDb(gain)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
