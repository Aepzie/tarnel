import { useLayoutEffect, useState, type RefObject } from 'react';

export interface BoxSize {
  width: number;
  height: number;
}

/**
 * Layout size of an element, ignoring transforms (the popover opens with a scale animation, so
 * getBoundingClientRect would report a shrunken box on mount).
 */
export function useBoxSize(ref: RefObject<HTMLElement | null>): BoxSize | null {
  const [size, setSize] = useState<BoxSize | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (): void => {
      const next = { width: element.offsetWidth, height: element.offsetHeight };
      setSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
