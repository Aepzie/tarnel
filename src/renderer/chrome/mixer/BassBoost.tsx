import { useEffect, useRef, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import type { BassBoost as BassBoostSettings } from '@shared/audio-mixer';
import { cn } from '@/lib/utils';
import { useBoxSize } from './use-box-size';
import { Knob } from './Knob';
import { bassOf, onFrame, themeColors } from './levels';

export const BASS_GAIN = { min: 0, max: 12 } as const;
export const BASS_FREQUENCY = { min: 40, max: 250 } as const;

const formatGain = (gain: number): string => (gain === 0 ? 'Off' : `+${gain % 1 ? gain.toFixed(1) : gain} dB`);
const formatFrequency = (frequency: number): string => `${Math.round(frequency)} Hz`;

/** 0..1 position of the shelf frequency on its log range. */
const frequencyUnit = (frequency: number): number =>
  Math.log(frequency / BASS_FREQUENCY.min) / Math.log(BASS_FREQUENCY.max / BASS_FREQUENCY.min);

/**
 * "Bass wave": a slow low-frequency wave whose height follows the boost and breathes with the live
 * bass level; longer wavelength for a lower shelf frequency. Static under reduced motion.
 */
function BassWave({ tabId, gain, frequency }: { tabId: number; gain: number; frequency: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useBoxSize(boxRef);
  const reduce = !!useReducedMotion();
  const params = useRef({ gain, frequency });
  params.current = { gain, frequency };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size?.width) return;
    const { width, height } = size;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    let phase = 0;
    let bass = 0;
    let drawn = '';

    const draw = (): void => {
      const { gain, frequency } = params.current;
      const unit = frequencyUnit(frequency);
      const cycles = 1.3 + unit * 3.4;
      const boost = gain / BASS_GAIN.max;
      const { accent, light } = themeColors();
      const amplitude = Math.min(0.94, (gain > 0 ? 0.16 + boost * 0.5 : 0.07) + bass * (gain > 0 ? 0.38 : 0.16));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const mid = height / 2;
      const wave = (offset: number, scale: number): Path2D => {
        const path = new Path2D();
        for (let x = 0; x <= width; x += 2) {
          const envelope = Math.sin((Math.PI * x) / width) ** 0.9;
          const y = mid - Math.sin((x / width) * cycles * Math.PI * 2 - phase - offset) * amplitude * scale * envelope * (mid - 3);
          if (x === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        }
        return path;
      };
      const color = gain > 0 ? accent : light ? 'rgb(0 0 0 / 0.35)' : 'rgb(255 255 255 / 0.3)';
      context.lineJoin = 'round';
      context.strokeStyle = color;
      context.lineWidth = 1.25;
      context.globalAlpha = 0.14;
      context.stroke(wave(1.9, 0.45));
      context.globalAlpha = 0.28;
      context.stroke(wave(0.95, 0.72));
      const main = wave(0, 1);
      context.globalAlpha = 1;
      context.lineWidth = 2;
      context.shadowColor = gain > 0 ? accent : 'transparent';
      context.shadowBlur = gain > 0 ? 10 + bass * 12 : 0;
      context.stroke(main);
      context.shadowBlur = 0;
      if (gain > 0) {
        const area = new Path2D(main);
        area.lineTo(width, mid);
        area.lineTo(0, mid);
        area.closePath();
        context.fillStyle = accent;
        context.globalAlpha = 0.07 + bass * 0.05;
        context.fill(area);
      }
      context.globalAlpha = 1;
    };

    return onFrame((dt) => {
      if (reduce) {
        const key = `${params.current.gain}:${params.current.frequency}:${themeColors().light}`;
        if (key !== drawn) draw();
        drawn = key;
        return;
      }
      const target = bassOf(tabId);
      bass += (target - bass) * Math.min(1, (target > bass ? 14 : 4) * dt);
      phase += dt * (0.9 + frequencyUnit(params.current.frequency) * 1.8) * Math.PI * 2 * 0.35;
      draw();
    });
  }, [tabId, size, reduce]);

  return (
    <div ref={boxRef} className="relative h-full min-w-0 flex-1">
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
    </div>
  );
}

interface BassBoostProps {
  tabId: number;
  bassBoost: BassBoostSettings;
  onChange: (patch: Partial<BassBoostSettings>) => void;
}

/** Bass boost: low-shelf gain (0–12 dB) and corner frequency (40–250 Hz), with the live bass wave. */
export function BassBoost({ tabId, bassBoost, onChange }: BassBoostProps) {
  const on = bassBoost.gain > 0;
  return (
    <section aria-label="Bass boost" className="flex h-[84px] items-stretch gap-3 rounded-xl bg-foreground/[0.025] px-3 py-2.5 ring-1 ring-foreground/[0.06] ring-inset">
      <div className="flex w-[74px] shrink-0 flex-col justify-between">
        <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">Bass</span>
        <span className={cn('text-[17px] leading-none font-semibold tracking-tight tabular-nums', on ? 'text-foreground' : 'text-zinc-500')}>
          {on ? `+${bassBoost.gain % 1 ? bassBoost.gain.toFixed(1) : bassBoost.gain}` : 'Off'}
          {on && <span className="ml-0.5 text-[11px] font-medium text-zinc-500">dB</span>}
        </span>
        <span className="text-[11px] text-zinc-500 tabular-nums">below {Math.round(bassBoost.frequency)} Hz</span>
      </div>
      <BassWave tabId={tabId} gain={bassBoost.gain} frequency={bassBoost.frequency} />
      <div className="flex shrink-0 items-center gap-3">
        <KnobField label="Boost">
          <Knob
            label="Bass boost"
            value={bassBoost.gain}
            min={BASS_GAIN.min}
            max={BASS_GAIN.max}
            step={0.5}
            defaultValue={0}
            format={formatGain}
            onChange={(gain) => onChange({ gain })}
          />
        </KnobField>
        <KnobField label="Freq">
          <Knob
            label="Bass frequency"
            value={bassBoost.frequency}
            min={BASS_FREQUENCY.min}
            max={BASS_FREQUENCY.max}
            step={1}
            log
            defaultValue={90}
            format={formatFrequency}
            onChange={(frequency) => onChange({ frequency })}
          />
        </KnobField>
      </div>
    </section>
  );
}

function KnobField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {children}
      <span className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase">{label}</span>
    </div>
  );
}
