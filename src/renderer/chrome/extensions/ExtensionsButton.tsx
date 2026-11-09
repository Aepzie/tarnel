import { useRef, useState, type MouseEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Pin, Puzzle, Settings2 } from 'lucide-react';
import type { ExtensionAction, ExtensionAnchor, ExtensionInfo } from '@shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useOverlayPresence } from '@/hooks/overlay';
import { settle, vela } from '@/lib/vela';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { IslandTooltip } from '../island/IslandTooltip';
import { GLASS_SURFACE } from '../spaces/surface';
import { useExtensions } from './extensions-store';

const ICON_BUTTON =
  'no-drag relative grid size-7 shrink-0 place-items-center rounded-[10px] text-muted-foreground outline-none transition-[background-color,color] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]';

function anchorOf(element: Element): ExtensionAnchor {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function activate(id: string, element: Element | null, kind: 'click' | 'contextmenu' = 'click'): void {
  if (element) settle(vela().extensions.activate(id, anchorOf(element), kind));
}

function Glyph({ icon, name, className }: { icon: string | null; name: string; className?: string }) {
  if (icon) return <img src={icon} alt="" draggable={false} className={cn('size-4 shrink-0 rounded-[3px] object-contain', className)} />;
  return (
    <span
      aria-hidden
      className={cn('grid size-4 shrink-0 place-items-center rounded-[4px] bg-foreground/10 text-[9px] font-semibold uppercase', className)}
    >
      {name.trim()[0] ?? '?'}
    </span>
  );
}

function ActionBadge({ action }: { action: ExtensionAction }) {
  return (
    <AnimatePresence>
      {action.badgeText && (
        <motion.span
          key="badge"
          aria-hidden
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          transition={spring.pop}
          className="pointer-events-none absolute -right-0.5 -bottom-0.5 h-3.5 min-w-3.5 rounded-full px-[3px] text-center text-[9px] leading-[14px] font-semibold text-white tabular-nums shadow-[0_0_0_2px_var(--island)]"
          style={{ backgroundColor: action.badgeColor ?? 'var(--accent-space)' }}
        >
          {action.badgeText}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function ActionButton({ action, name }: { action: ExtensionAction; name: string }) {
  const reduce = useReducedMotion();
  const label = action.title || name;
  return (
    <IslandTooltip label={label}>
      <motion.button
        type="button"
        layout="position"
        aria-label={action.badgeText ? `${label} (${action.badgeText})` : label}
        className={ICON_BUTTON}
        initial={reduce ? false : { opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
        transition={spring.pop}
        onClick={(event) => activate(action.id, event.currentTarget)}
        onContextMenu={(event) => {
          event.preventDefault();
          activate(action.id, event.currentTarget, 'contextmenu');
        }}
      >
        <Glyph icon={action.icon} name={name} />
        <ActionBadge action={action} />
      </motion.button>
    </IslandTooltip>
  );
}

function MenuRow({
  extension,
  action,
  onRun,
}: {
  extension: ExtensionInfo;
  action: ExtensionAction | undefined;
  onRun: (id: string) => void;
}) {
  const running = !!action;
  const note = extension.error ? 'Couldn’t load' : !extension.enabled ? 'Turned off' : running ? null : 'Off in this Space';

  const togglePin = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    settle(vela().extensions.setPinned(extension.id, !extension.pinned));
  };

  return (
    <div className="group/row flex items-center gap-1 rounded-[10px] pr-1 transition-colors duration-100 hover:bg-accent">
      <button
        type="button"
        disabled={!running}
        onClick={() => onRun(extension.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          if (running) activate(extension.id, event.currentTarget, 'contextmenu');
        }}
        className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <span className="relative">
          <Glyph icon={action?.icon ?? extension.icon} name={extension.name} className={cn(!running && 'opacity-40 grayscale')} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate text-[13px] leading-4 tracking-tight', !running && 'text-muted-foreground')}>
            {extension.name}
          </span>
          {note && (
            <span className={cn('truncate text-[11px] leading-4', extension.error ? 'text-destructive' : 'text-muted-foreground')}>
              {note}
            </span>
          )}
        </span>
        {action?.badgeText && (
          <span
            className="rounded-full px-1.5 text-[10px] leading-4 font-semibold text-white tabular-nums"
            style={{ backgroundColor: action.badgeColor ?? 'var(--accent-space)' }}
          >
            {action.badgeText}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-pressed={extension.pinned}
        aria-label={extension.pinned ? `Unpin ${extension.name}` : `Pin ${extension.name}`}
        title={extension.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'}
        onClick={togglePin}
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-lg outline-none transition-[color,opacity,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.9]',
          extension.pinned
            ? 'text-space'
            : 'text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100',
        )}
      >
        <Pin className={cn('size-3.5', extension.pinned && 'fill-current')} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/**
 * Pinned extension actions plus the puzzle-piece menu. Renders nothing until an extension is
 * installed, so a browser without extensions keeps its island exactly as it was.
 */
export function ExtensionsButton() {
  const { extensions, actions } = useExtensions();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  useOverlayPresence(open && extensions.length > 0);

  if (extensions.length === 0) return null;

  const actionById = new Map(actions.map((action) => [action.id, action]));
  const pinned = extensions.filter((extension) => extension.pinned && actionById.has(extension.id));

  const run = (id: string): void => {
    setOpen(false);
    activate(id, trigger.current);
  };

  const manage = (): void => {
    setOpen(false);
    settle(vela().tabs.create({ url: 'vela://settings/#extensions', active: true }));
  };

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <AnimatePresence initial={false}>
        {pinned.map((extension) => (
          <ActionButton key={extension.id} action={actionById.get(extension.id)!} name={extension.name} />
        ))}
      </AnimatePresence>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <motion.button
            ref={trigger}
            type="button"
            layout="position"
            aria-label="Extensions"
            title="Extensions"
            className={cn(ICON_BUTTON, open && 'bg-accent text-foreground')}
            initial={reduce ? false : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={spring.pop}
          >
            <Puzzle className="size-4" strokeWidth={1.75} />
          </motion.button>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          sideOffset={10}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className={cn(GLASS_SURFACE, 'w-72 rounded-2xl p-1.5')}
        >
          <header className="flex h-8 items-center justify-between px-2">
            <span className="text-[12.5px] font-semibold tracking-tight">Extensions</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">{extensions.length}</span>
          </header>
          <div className="max-h-[min(360px,55vh)] overflow-y-auto overscroll-contain">
            {extensions.map((extension) => (
              <MenuRow key={extension.id} extension={extension} action={actionById.get(extension.id)} onRun={run} />
            ))}
          </div>
          <div className="mx-2 my-1 h-px bg-border" />
          <button
            type="button"
            onClick={manage}
            className="flex h-8 w-full items-center gap-2.5 rounded-[10px] px-2 text-[13px] tracking-tight text-muted-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 className="size-4" strokeWidth={1.75} />
            Manage extensions
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
