import { useEffect, useState } from 'react';
import { MAX_DROPPED } from '@shared/ipc';
import { settle } from '@/lib/vela';
import { cn } from '@/lib/utils';

/** Drags from outside the window (files, links); in-app drags (bookmarks) use their own types. */
function isExternalDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types ?? [];
  return types.includes('Files') || types.includes('text/uri-list');
}

function droppedLinks(transfer: DataTransfer): string[] {
  const uriList = transfer.getData('text/uri-list');
  const links = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (links.length > 0) return links;
  const text = transfer.getData('text/plain').trim();
  return text ? [text] : [];
}

/**
 * Files or links dropped anywhere on the chrome UI (tab strip, vertical tab list, "+", empty
 * areas) open in new tabs, routed through main. Drops on the page itself are handled by the page
 * view (Chromium navigates the tab, or the page takes the drop). A hairline accent ring shows the
 * window accepts the drop; it fades only when motion is allowed.
 */
export function FileDropLayer() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;
    const reset = (): void => {
      depth = 0;
      setActive(false);
    };
    const onEnter = (event: DragEvent): void => {
      if (!isExternalDrag(event)) return;
      event.preventDefault();
      depth += 1;
      setActive(true);
    };
    const onOver = (event: DragEvent): void => {
      if (!isExternalDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (event: DragEvent): void => {
      if (!isExternalDrag(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDrop = (event: DragEvent): void => {
      const transfer = event.dataTransfer;
      if (!transfer || !isExternalDrag(event)) return;
      event.preventDefault();
      reset();
      const files = [...transfer.files].slice(0, MAX_DROPPED);
      const paths = files.map((file) => window.vela.files.pathFor(file)).filter(Boolean);
      const links = files.length > 0 ? [] : droppedLinks(transfer).slice(0, MAX_DROPPED);
      if (paths.length + links.length > 0) settle(window.vela.files.openDropped(paths, links));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
    };
  }, []);

  return (
    <div
      aria-hidden
      data-drop-active={active || undefined}
      className={cn(
        'pointer-events-none fixed inset-1 z-50 rounded-[14px] ring-1 ring-space/60 ring-inset opacity-0 motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-out',
        active && 'opacity-100',
      )}
    />
  );
}
