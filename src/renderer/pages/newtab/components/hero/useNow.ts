import { useEffect, useState } from 'react';

/** Current time, re-rendered exactly on each `stepMs` boundary of the wall clock (1000 = seconds, 60000 = minutes). */
export function useNow(stepMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const schedule = (): void => {
      const wait = stepMs - (Date.now() % stepMs) + 8;
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, wait);
    };
    const onVisible = (): void => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      setNow(new Date());
      schedule();
    };
    setNow(new Date());
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [stepMs]);
  return now;
}

/** UI locale for date/greeting text. */
export const locale = (): string => (typeof navigator !== 'undefined' && navigator.language) || 'en';
