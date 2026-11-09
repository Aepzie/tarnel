import { useEffect } from 'react';

/** Ultra-subtle accent aurora + film grain. Pure CSS transforms; paused while the tab is hidden. */
export function Aurora() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = (): void => {
      if (document.hidden) root.setAttribute('data-hidden', '');
      else root.removeAttribute('data-hidden');
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  return (
    <>
      <div className="vt-aurora" aria-hidden="true">
        <div className="vt-blob vt-blob-a" />
        <div className="vt-blob vt-blob-b" />
        <div className="vt-blob vt-blob-c" />
      </div>
      <div className="vt-noise" aria-hidden="true" />
    </>
  );
}
