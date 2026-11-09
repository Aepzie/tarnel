import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { levelOf, meterPosition, newBallistics, onFrame, stepBallistics } from './levels';

/** Meter position of 0 dBFS-ish clipping and the -6 dB "hot" zone. */
const HOT = meterPosition(0.5);

/**
 * Stereo peak meter (two thin vertical bars) driven straight from the rAF loop: no React state per
 * frame. The fill is clipped rather than scaled so the hot/clip colours stay at fixed heights.
 */
export function StereoMeter({ tabId, muted, className }: { tabId: number; muted: boolean; className?: string }) {
  const reduce = !!useReducedMotion();
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const holds = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const channels = [newBallistics(), newBallistics()];
    const painted = [-1, -1, -1, -1];
    return onFrame((dt) => {
      const level = levelOf(tabId);
      const targets = muted || !level ? [0, 0] : [meterPosition(level.peakL), meterPosition(level.peakR)];
      channels.forEach((state, index) => {
        stepBallistics(state, targets[index]!, dt, reduce);
        const value = Math.round(state.value * 400) / 400;
        const hold = Math.round(state.hold * 400) / 400;
        const fill = fills.current[index];
        const mark = holds.current[index];
        if (fill && painted[index] !== value) {
          painted[index] = value;
          fill.style.clipPath = `inset(${((1 - value) * 100).toFixed(2)}% 0 0 0)`;
        }
        if (mark && painted[index + 2] !== hold) {
          painted[index + 2] = hold;
          mark.style.transform = `translateY(${((1 - hold) * 100).toFixed(2)}cqh)`;
          mark.style.opacity = hold > 0.02 ? '1' : '0';
        }
      });
    });
  }, [tabId, muted, reduce]);

  return (
    <div aria-hidden className={cn('flex h-full gap-[3px] [container-type:size]', className)}>
      {[0, 1].map((index) => (
        <span key={index} className="relative h-full w-[3px] overflow-hidden rounded-full bg-foreground/[0.07]">
          <span
            ref={(node) => {
              fills.current[index] = node;
            }}
            className="absolute inset-0 rounded-full [clip-path:inset(100%_0_0_0)]"
            style={{
              background: `linear-gradient(to top, var(--accent-space) 0%, var(--accent-space) ${HOT * 100}%, #fbbf24 ${HOT * 100 + 8}%, #f87171 97%)`,
            }}
          />
          <span
            ref={(node) => {
              holds.current[index] = node;
            }}
            className="absolute inset-x-0 top-0 h-[2px] rounded-full bg-foreground/70 opacity-0"
          />
        </span>
      ))}
    </div>
  );
}
