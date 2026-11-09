import { useId, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { spring } from '@/lib/motion';

export const SPARK_SAMPLES = 30;

interface SparklineProps {
  samples: number[];
  width: number;
  height: number;
  className?: string;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Always SPARK_SAMPLES points (left-padded with the oldest sample) so every path has the same command
 * structure and motion can interpolate `d` smoothly between polls.
 */
function toPoints(samples: number[], width: number, height: number): Point[] {
  const first = samples[0] ?? 0;
  const padded = [...Array<number>(Math.max(0, SPARK_SAMPLES - samples.length)).fill(first), ...samples].slice(-SPARK_SAMPLES);
  const min = Math.min(...padded);
  const max = Math.max(...padded);
  const span = Math.max(max - min, max * 0.04, 8);
  const mid = (max + min) / 2;
  const top = 6;
  const usable = height - top - 4;
  const step = width / (SPARK_SAMPLES - 1);
  return padded.map((value, i) => ({
    x: i * step,
    y: top + usable * (0.5 - (value - mid) / span),
  }));
}

/** Smooth cubic through points (midpoint control handles) — constant segment count. */
function linePath(points: Point[]): string {
  const [head, ...rest] = points;
  if (!head) return '';
  let d = `M${head.x.toFixed(2)},${head.y.toFixed(2)}`;
  let prev = head;
  for (const p of rest) {
    const cx = (prev.x + p.x) / 2;
    d += ` C${cx.toFixed(2)},${prev.y.toFixed(2)} ${cx.toFixed(2)},${p.y.toFixed(2)} ${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    prev = p;
  }
  return d;
}

/** Live memory sparkline: accent stroke, accent fill that fades to nothing, glowing head dot. */
export function Sparkline({ samples, width, height, className }: SparklineProps) {
  const reduce = useReducedMotion();
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { line, area, head } = useMemo(() => {
    const points = toPoints(samples, width, height);
    const path = linePath(points);
    return {
      line: path,
      area: `${path} L${width},${height} L0,${height} Z`,
      head: points[points.length - 1] ?? { x: width, y: height / 2 },
    };
  }, [samples, width, height]);

  const transition = reduce ? { duration: 0 } : spring.soft;
  const empty = samples.length === 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      overflow="visible"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-space)" stopOpacity={0.28} />
          <stop offset="100%" stopColor="var(--accent-space)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {!empty && (
        <>
          <motion.path initial={false} animate={{ d: area }} transition={transition} fill={`url(#${gradientId})`} />
          <motion.path
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ d: line, pathLength: 1 }}
            transition={reduce ? { duration: 0 } : { d: spring.soft, pathLength: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } }}
            fill="none"
            stroke="var(--accent-space)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <motion.circle
            r={6}
            fill="var(--accent-space)"
            initial={false}
            animate={reduce ? { cx: head.x, cy: head.y, opacity: 0.2 } : { cx: head.x, cy: head.y, opacity: [0.35, 0, 0.35], scale: [0.6, 1.4, 0.6] }}
            transition={
              reduce
                ? { duration: 0 }
                : { cx: spring.soft, cy: spring.soft, opacity: { duration: 2, repeat: Infinity }, scale: { duration: 2, repeat: Infinity } }
            }
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
          <motion.circle
            r={2.5}
            fill="var(--accent-space)"
            stroke="var(--popover)"
            strokeWidth={1.5}
            initial={false}
            animate={{ cx: head.x, cy: head.y }}
            transition={transition}
          />
        </>
      )}
    </svg>
  );
}
