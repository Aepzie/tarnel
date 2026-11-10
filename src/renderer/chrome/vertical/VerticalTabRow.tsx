import { memo, useRef, type MouseEvent, type PointerEvent } from 'react';
import { Reorder, motion, useReducedMotion, type Transition } from 'motion/react';
import { XIcon } from 'lucide-react';
import type { TabState } from '@shared/types';
import { useTabClosable } from '@/hooks/browser';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { Favicon } from '../tabs/Favicon';
import { TabContextMenu } from '../tabs/TabContextMenu';
import { AudioButton } from '../tabs/TabItem';

const INSTANT: Transition = { duration: 0 };
export const ROW_HEIGHT = 32;

/** Active row highlight; one shared layoutId so it glides between rows. */
export const ACTIVE_ROW =
  'absolute inset-0 rounded-[10px] bg-white/[0.07] ring-1 ring-white/10 light:bg-black/[0.05] light:ring-black/[0.07] ' +
  'shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-space)_30%,transparent),0_6px_18px_-8px_color-mix(in_oklab,var(--accent-space)_45%,transparent),inset_0_1px_0_rgb(255_255_255/0.06)]';

interface VerticalTabRowProps {
  tab: TabState;
  active: boolean;
  /** Island collapsed to icons: favicon only, title as tooltip. */
  iconOnly: boolean;
  /** Group color (hex) when the tab is a group member: drawn as a rail on the left. */
  groupColor?: string;
  /** Last visible member: the rail ends with a rounded cap. */
  groupEnd?: boolean;
  onDragStart: (id: number) => void;
  onDragEnd: (id: number) => void;
}

function activate(tab: TabState, active: boolean): void {
  if (!active) settle(vela().tabs.activate(tab.id));
}

/** One row of the vertical tab list (memoized on the fields it renders). */
function VerticalTabRowImpl({ tab, active, iconOnly, groupColor, groupEnd = false, onDragStart, onDragEnd }: VerticalTabRowProps) {
  const reduced = !!useReducedMotion();
  const dragged = useRef(false);
  const label = tab.title || tab.url || 'New Tab';
  const grouped = !!groupColor;
  const closable = useTabClosable(tab);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    dragged.current = false;
    if (event.button === 0) activate(tab, active);
  };

  const onAuxClick = (event: MouseEvent): void => {
    if (event.button !== 1) return;
    event.preventDefault();
    settle(vela().tabs.close(tab.id));
  };

  return (
    <TabContextMenu tab={tab}>
      <Reorder.Item
        as="div"
        value={tab.id}
        layout="position"
        role="tab"
        aria-selected={active}
        aria-label={label}
        tabIndex={active ? 0 : -1}
        data-tab-id={tab.id}
        title={iconOnly ? label : undefined}
        initial={reduced ? false : { opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: ROW_HEIGHT }}
        exit={reduced ? { opacity: 0, transition: INSTANT } : { opacity: 0, height: 0, transition: { ...spring.snappy, opacity: { duration: 0.1 } } }}
        transition={reduced ? INSTANT : spring.snappy}
        whileDrag={{ scale: reduced ? 1 : 1.02, zIndex: 20 }}
        dragElastic={0.06}
        onDragStart={() => {
          dragged.current = true;
          onDragStart(tab.id);
        }}
        onDragEnd={() => onDragEnd(tab.id)}
        onPointerDown={onPointerDown}
        onMouseDown={(event) => event.button === 1 && event.preventDefault()}
        onAuxClick={onAuxClick}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          activate(tab, active);
        }}
        className={cn(
          'group/row no-drag relative flex shrink-0 cursor-default items-center rounded-[10px] outline-none select-none',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
          !active && 'transition-colors duration-150 hover:bg-accent',
        )}
      >
        {active && (
          <motion.span layoutId="vertical-active-tab" className={ACTIVE_ROW} transition={reduced ? INSTANT : spring.snappy} />
        )}
        {grouped && (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute w-[2px] rounded-full opacity-70',
              iconOnly ? 'left-0.5' : 'left-[15px]',
              groupEnd ? 'top-0 bottom-1.5' : '-top-px -bottom-px',
            )}
            style={{ backgroundColor: groupColor }}
          />
        )}
        <span
          className={cn(
            'relative z-10 flex h-full min-w-0 flex-1 items-center gap-2.5',
            iconOnly ? 'justify-center' : grouped ? 'pr-1 pl-7' : 'pr-1 pl-2.5',
          )}
        >
          <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
            <Favicon src={tab.favicon} url={tab.url} title={tab.title} asleep={tab.asleep} />
            {tab.loading && (
              <span className="absolute -inset-1 animate-spin rounded-full border-[1.5px] border-transparent border-t-space [animation-duration:0.8s]" />
            )}
          </span>
          {!iconOnly && (
            <>
              <span
                className={cn(
                  'min-w-0 flex-1 overflow-hidden text-[13px] leading-none tracking-tight whitespace-nowrap transition-colors duration-150',
                  '[mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)] group-hover/row:[mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent_calc(100%-20px))]',
                  active ? 'text-zinc-100 light:text-zinc-900' : 'text-zinc-400 group-hover/row:text-zinc-100 light:text-zinc-600 light:group-hover/row:text-zinc-900',
                  tab.asleep && !active && 'text-zinc-500 light:text-zinc-500',
                )}
              >
                {tab.title || 'New Tab'}
              </span>
              <AudioButton tab={tab} className={cn('transition-[margin,background-color,color]', closable && 'group-hover/row:mr-6')} />
              {closable && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Close tab"
                  className={cn(
                    'absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-[opacity,background-color,color] duration-150',
                    'group-hover/row:opacity-100 group-focus-visible/row:opacity-100 hover:bg-white/10 hover:text-zinc-100 active:scale-[0.92]',
                    'light:text-zinc-500 light:hover:bg-black/[0.07] light:hover:text-zinc-900',
                  )}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    settle(vela().tabs.close(tab.id));
                  }}
                >
                  <XIcon className="size-3.5" strokeWidth={2} />
                </button>
              )}
            </>
          )}
        </span>
      </Reorder.Item>
    </TabContextMenu>
  );
}

function same(a: VerticalTabRowProps, b: VerticalTabRowProps): boolean {
  if (a.active !== b.active || a.iconOnly !== b.iconOnly || a.groupColor !== b.groupColor || a.groupEnd !== b.groupEnd) return false;
  if (a.onDragStart !== b.onDragStart || a.onDragEnd !== b.onDragEnd) return false;
  const x = a.tab;
  const y = b.tab;
  return (
    x === y ||
    (x.id === y.id &&
      x.title === y.title &&
      x.url === y.url &&
      x.favicon === y.favicon &&
      x.loading === y.loading &&
      x.asleep === y.asleep &&
      x.audible === y.audible &&
      x.muted === y.muted &&
      x.micActive === y.micActive &&
      !x.devices === !y.devices &&
      x.pinned === y.pinned &&
      x.groupId === y.groupId &&
      x.spaceId === y.spaceId)
  );
}

export const VerticalTabRow = memo(VerticalTabRowImpl, same);
