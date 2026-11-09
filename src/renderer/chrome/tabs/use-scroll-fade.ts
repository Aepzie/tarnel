import { useEffect, useState, type RefObject } from 'react';

export interface ScrollFade {
  left: boolean;
  right: boolean;
}

/** Tracks whether a horizontal scroller has hidden content on either edge (for fade masks). */
export function useScrollFade(ref: RefObject<HTMLElement | null>): ScrollFade {
  const [fade, setFade] = useState<ScrollFade>({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setFade((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const resize = new ResizeObserver(schedule);
    const observeTree = (): void => {
      resize.disconnect();
      resize.observe(el);
      el.querySelectorAll('[role="tab"]').forEach((tab) => resize.observe(tab));
    };
    const mutations = new MutationObserver(() => {
      observeTree();
      schedule();
    });

    observeTree();
    mutations.observe(el, { childList: true, subtree: true });
    el.addEventListener('scroll', schedule, { passive: true });
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      el.removeEventListener('scroll', schedule);
    };
  }, [ref]);

  return fade;
}
