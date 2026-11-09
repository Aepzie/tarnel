import { useLayoutEffect, useRef, useState } from 'react';
import type { TabGroup } from '@shared/types';
import { useOverlay } from '@/hooks/overlay';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { setEditingGroup } from './group-ui';

/**
 * Inline group-name editor. Commits on Enter / blur, reverts on Escape. Holds the overlay so the
 * chrome view keeps keyboard focus (main hands focus back to the page when the overlay drops).
 */
export function GroupNameInput({ group, className }: { group: TabGroup; className?: string }) {
  const [value, setValue] = useState(group.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useOverlay(true);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true });
      ref.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const finish = (commit: boolean): void => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (commit && name !== group.name) settle(vela().groups.update(group.id, { name }));
    setEditingGroup(null);
  };

  return (
    <input
      ref={ref}
      value={value}
      maxLength={64}
      spellCheck={false}
      aria-label="Group name"
      placeholder="Name this group"
      size={Math.max(6, Math.min(18, value.length + 1))}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        else if (event.key === 'Escape') finish(false);
      }}
      className={cn(
        'no-drag min-w-0 bg-transparent text-[12px] font-medium tracking-tight outline-none placeholder:text-current/50',
        className,
      )}
    />
  );
}
