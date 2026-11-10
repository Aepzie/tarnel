import type { Rectangle } from 'electron';

/** How close (px) to a display's outer edge the pointer must be released to snap. */
const EDGE = 2;

export type SnapZone = 'maximize' | 'left' | 'right';

/** Which Aero-Snap zone a drag released at `point` on a display with `bounds` lands in, if any. */
export function snapZone(point: { x: number; y: number }, bounds: Rectangle): SnapZone | null {
  if (point.y <= bounds.y + EDGE) return 'maximize';
  if (point.x <= bounds.x + EDGE) return 'left';
  if (point.x >= bounds.x + bounds.width - 1 - EDGE) return 'right';
  return null;
}

/** The half of `workArea` a left/right snap fills. */
export function snapBounds(zone: 'left' | 'right', workArea: Rectangle): Rectangle {
  const left = Math.round(workArea.width / 2);
  if (zone === 'left') return { x: workArea.x, y: workArea.y, width: left, height: workArea.height };
  return { x: workArea.x + left, y: workArea.y, width: workArea.width - left, height: workArea.height };
}
