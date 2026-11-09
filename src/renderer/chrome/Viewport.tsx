import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { settle } from '@/lib/vela';

/**
 * Transparent placeholder where main places the active page view. Its rect (CSS px) is reported
 * once it has been stable for a frame, so height animations (island spacer, find strip) cost one
 * native setBounds at settle instead of one per frame; window resizes still report every frame.
 * Main applies radius 12 to the view; the ring only shows while a page is (re)loading or there is no tab.
 */
export function Viewport({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let last = '';
    let pending = '';
    const measure = (): { key: string; rect: { x: number; y: number; width: number; height: number } } => {
      const r = el.getBoundingClientRect();
      const rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      return { key: `${rect.x},${rect.y},${rect.width},${rect.height}`, rect };
    };
    let windowKey = '';
    const tick = (): void => {
      const { key, rect } = measure();
      const nextWindowKey = `${window.innerWidth}x${window.innerHeight}`;
      const windowResized = nextWindowKey !== windowKey;
      windowKey = nextWindowKey;
      if (key !== pending && !windowResized) {
        pending = key;
        frame = requestAnimationFrame(tick);
        return;
      }
      pending = key;
      frame = 0;
      if (key === last) return;
      last = key;
      settle(window.vela.ui.setContentBounds(rect));
    };
    const report = (): void => {
      if (frame) return;
      pending = '';
      frame = requestAnimationFrame(tick);
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    observer.observe(document.body);
    window.addEventListener('resize', report);
    // Island slide animations move the viewport without resizing it — poll briefly after transitions.
    el.addEventListener('transitionend', report);
    report();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', report);
      el.removeEventListener('transitionend', report);
    };
  }, []);

  return (
    <main
      ref={ref}
      id="viewport"
      className={cn('relative min-h-0 flex-1 rounded-xl bg-transparent ring-1 ring-island-ring', className)}
    />
  );
}
