import { useMemo } from 'react';
import { splitGeometry } from '@shared/split-layout';
import { cn } from '@/lib/utils';
import { activeSplitOf } from './split/split-state';
import { useBrowserSlice, shallowEqual } from '@/hooks/browser';
import { useViewportRect } from './viewport-rect';

const PAGE_RADIUS = 12;

/**
 * Light-theme window tint behind the islands, with holes where the page views are. Whenever the chrome
 * is raised above the pages (menus, palette, a split pane's toolbar) its transparent page area must
 * not wash the pages out, so the tint never covers them. A rounded-rect SVG mask cuts the holes.
 */
export function WindowTint({ className }: { className?: string }) {
  const rect = useViewportRect();
  const split = useBrowserSlice((s) => {
    const current = activeSplitOf(s);
    return current ? [current.tabIds.length, current.ratioX, current.ratioY] : null;
  }, shallowEqual);

  const mask = useMemo(() => {
    if (!rect) return undefined;
    const holes = split ? splitGeometry(rect, split[0]!, split[1]!, split[2]!).panes : [rect];
    const cutouts = holes
      .map((hole) => `<rect x='${hole.x}' y='${hole.y}' width='${hole.width}' height='${hole.height}' rx='${PAGE_RADIUS}' fill='black'/>`)
      .join('');
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%'><rect width='100%' height='100%' fill='white'/>${cutouts}</svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  }, [rect, split]);

  return (
    <div
      aria-hidden="true"
      className={cn('vela-window-tint pointer-events-none fixed inset-0 -z-10 transition-colors duration-300', className)}
      style={mask ? { maskImage: mask, maskMode: 'luminance', maskRepeat: 'no-repeat', maskSize: '100% 100%' } : undefined}
    />
  );
}
