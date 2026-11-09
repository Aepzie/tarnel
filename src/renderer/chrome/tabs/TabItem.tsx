import { memo, useRef, type MouseEvent, type PointerEvent, type Ref } from 'react';
import { AnimatePresence, Reorder, motion, useReducedMotion, type Transition } from 'motion/react';
import { CompassIcon, InfoIcon, LockIcon, SearchIcon, ShieldIcon, TriangleAlertIcon, Volume2Icon, VolumeXIcon, XIcon } from 'lucide-react';
import type { TabState } from '@shared/types';
import { cn } from '@/lib/utils';
import { spring } from '@/lib/motion';
import { addressSeed, formatCount, settle, vela } from '@/lib/vela';
import { ui } from '../ui-store';
import { Favicon } from './Favicon';
import { TabContextMenu } from './TabContextMenu';

export const PILL_MIN = 36;
export const PILL_MAX = 184;
/** Below this inactive pills only show the favicon. */
export const PILL_ICON_ONLY = 56;
/** The omnibox yields space until inactive pills reach this width. */
export const PILL_COMFORT = 112;
export const OMNI_MIN = 256;
export const OMNI_MAX = 520;

const INSTANT: Transition = { duration: 0 };

export interface TabItemProps {
  tab: TabState;
  active: boolean;
  hovered: boolean;
  /** Command palette open → the omnibox background hands its layoutId to the palette. */
  paletteOpen: boolean;
  onHover: (id: number | null) => void;
  onDragStart: (id: number) => void;
  onDragEnd: (id: number) => void;
  /** Width assigned by the strip's layout pass; falls back to intrinsic sizing until measured. */
  width?: number;
  /** Strip is crowded: inactive pills collapse to favicon only. */
  compact?: boolean;
  ref?: Ref<HTMLDivElement>;
}

interface Address {
  host: string;
  path: string;
  internal: boolean;
  empty: boolean;
}

function parseAddress(tab: TabState): Address {
  const url = tab.url;
  if (!url || url.startsWith('vela://newtab') || url === 'about:blank') return { host: '', path: '', internal: false, empty: true };
  if (url.startsWith('vela://')) return { host: tab.title || url, path: '', internal: true, empty: false };
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, '');
    if (!host) return { host: url, path: '', internal: false, empty: false };
    const rest = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}${parsed.hash}`;
    return { host, path: rest, internal: false, empty: false };
  } catch {
    return { host: url, path: '', internal: false, empty: false };
  }
}

function SecurityIcon({ tab, address }: { tab: TabState; address: Address }) {
  const cls = 'size-[15px] shrink-0';
  if (address.empty) return <SearchIcon className={cn(cls, 'text-zinc-400 light:text-zinc-500')} strokeWidth={1.75} />;
  if (address.internal) return <CompassIcon className={cn(cls, 'text-space')} strokeWidth={1.75} />;
  if (tab.secure) return <LockIcon className={cn(cls, 'text-zinc-400 light:text-zinc-500')} strokeWidth={1.75} />;
  if (tab.url.startsWith('http:')) return <TriangleAlertIcon className={cn(cls, 'text-amber-400/90 light:text-amber-600')} strokeWidth={1.75} />;
  return <InfoIcon className={cn(cls, 'text-zinc-400 light:text-zinc-500')} strokeWidth={1.75} />;
}

function BlockedBadge({ count, reduced }: { count: number; reduced: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {count > 0 && (
        <motion.span
          key="badge"
          initial={reduced ? false : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={reduced ? INSTANT : spring.pop}
          className="inline-flex h-5 shrink-0 items-center gap-1 overflow-hidden rounded-full bg-space/12 pr-1.5 pl-1 text-[11px] font-medium text-space tabular-nums"
          title={`${count} requests blocked`}
        >
          <ShieldIcon className="size-3" strokeWidth={2} />
          <span className="relative inline-flex">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={count}
                initial={reduced ? false : { y: -8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 8, opacity: 0 }}
                transition={reduced ? INSTANT : spring.pop}
              >
                {formatCount(count)}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function AudioButton({ tab, className }: { tab: TabState; className?: string }) {
  if (!tab.audible && !tab.muted) return null;
  const Icon = tab.muted ? VolumeXIcon : Volume2Icon;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={tab.muted ? 'Unmute tab' : 'Mute tab'}
      className={cn(
        'no-drag inline-flex size-5 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors duration-150 hover:bg-white/10 hover:text-zinc-100 active:scale-[0.92] light:text-zinc-500 light:hover:bg-black/[0.07] light:hover:text-zinc-900',
        tab.muted && 'text-zinc-500',
        className,
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        settle(vela().tabs.toggleMute(tab.id));
      }}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

function OmniboxContent({ tab, reduced, paletteOpen }: { tab: TabState; reduced: boolean; paletteOpen: boolean }) {
  const address = parseAddress(tab);
  return (
    <motion.span
      className="relative z-10 flex min-w-0 flex-1 items-center gap-2 px-3"
      initial={reduced ? false : { opacity: 0, filter: 'blur(4px)' }}
      animate={{ opacity: paletteOpen ? 0 : 1, filter: 'blur(0px)' }}
      transition={{ duration: reduced ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <SecurityIcon tab={tab} address={address} />
      <span className="flex min-w-0 flex-1 items-baseline text-[13px] leading-none tracking-tight">
        {address.empty ? (
          <span className="truncate text-zinc-400 light:text-zinc-500">Search or enter address</span>
        ) : (
          <>
            <span className="shrink-0 truncate font-medium text-zinc-100 light:text-zinc-900">{address.host}</span>
            {address.path && <span className="min-w-0 truncate text-zinc-500">{address.path}</span>}
          </>
        )}
      </span>
      <AudioButton tab={tab} className="-mr-1" />
      <BlockedBadge count={tab.blockedCount} reduced={reduced} />
    </motion.span>
  );
}

function LoadingBar({ show, reduced }: { show: boolean; reduced: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          key="loading"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 bottom-0 z-10 h-[2px] overflow-hidden rounded-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.24, delay: reduced ? 0 : 0.08 } }}
          transition={{ duration: reduced ? 0 : 0.14 }}
        >
          <span className="absolute inset-0 bg-space/15" />
          <span className="absolute inset-y-0 left-0 w-2/5 animate-shimmer bg-[linear-gradient(90deg,transparent,var(--accent-space),transparent)]" />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** One tab: an inactive pill, or — when active — the omnibox. Memoized on the fields it renders. */
function TabItemImpl({ tab, active, hovered, paletteOpen, onHover, onDragStart, onDragEnd, width, compact = false, ref }: TabItemProps) {
  const reduced = !!useReducedMotion();
  const dragged = useRef(false);
  const iconOnly = !active && (tab.pinned || compact);
  const minWidth = active ? OMNI_MIN : PILL_MIN;
  const maxWidth = active ? OMNI_MAX : iconOnly ? PILL_MIN : PILL_MAX;
  const sized = width !== undefined;
  const targetWidth = iconOnly ? PILL_MIN : width;
  const layoutTransition = reduced ? INSTANT : spring.snappy;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    dragged.current = false;
    if (e.button !== 0) return;
    if (!active) settle(vela().tabs.activate(tab.id));
  };

  const onClick = (): void => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (active) ui.openPalette('current', addressSeed(tab.url));
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
  };

  const onAuxClick = (e: MouseEvent): void => {
    if (e.button !== 1) return;
    e.preventDefault();
    settle(vela().tabs.close(tab.id));
  };

  const label = tab.title || tab.url || 'New Tab';

  return (
    <TabContextMenu tab={tab}>
      <Reorder.Item
        ref={ref}
        as="div"
        value={tab.id}
        layout="position"
        role="tab"
        aria-selected={active}
        aria-label={label}
        tabIndex={active ? 0 : -1}
        data-tab-id={tab.id}
        data-omnibox={active ? '' : undefined}
        title={active ? undefined : label}
        initial={reduced ? false : { opacity: 0, scale: 0.92, width: 0, minWidth: 0 }}
        animate={
          sized
            ? { opacity: 1, scale: 1, width: targetWidth, minWidth: 0, maxWidth: 'none' }
            : { opacity: 1, scale: 1, width: 'auto', minWidth, maxWidth }
        }
        exit={reduced ? { opacity: 0, transition: INSTANT } : { opacity: 0, scale: 0.92, width: 0, minWidth: 0, transition: { ...spring.snappy, opacity: { duration: 0.12 } } }}
        transition={layoutTransition}
        whileDrag={{ scale: reduced ? 1 : 1.03, zIndex: 20 }}
        dragElastic={0.08}
        onDragStart={() => {
          dragged.current = true;
          onDragStart(tab.id);
        }}
        onDragEnd={() => onDragEnd(tab.id)}
        onPointerDown={onPointerDown}
        onPointerEnter={() => onHover(active ? null : tab.id)}
        onPointerLeave={() => onHover(null)}
        onMouseDown={onMouseDown}
        onAuxClick={onAuxClick}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          if (active) onClick();
          else settle(vela().tabs.activate(tab.id));
        }}
        className={cn(
          'group/tab no-drag relative flex h-8 shrink-0 cursor-default items-center rounded-[10px] outline-none select-none',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
          sized ? 'shrink-0' : active ? 'grow' : 'shrink',
        )}
      >
        {active ? (
          <>
            {paletteOpen ? (
              <span className="absolute inset-0 rounded-[10px] bg-white/[0.03] ring-1 ring-white/[0.06] light:bg-black/[0.03] light:ring-black/[0.05]" />
            ) : (
              <motion.span
                layoutId="omnibox"
                transition={reduced ? INSTANT : spring.snappy}
                style={{ borderRadius: 10 }}
                className={cn(
                  'absolute inset-0 bg-white/[0.06] ring-1 ring-white/10 transition-colors duration-150 hover:bg-white/[0.08]',
                  'light:bg-black/[0.04] light:ring-black/[0.07] light:hover:bg-black/[0.06]',
                  'shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-space)_35%,transparent),0_8px_24px_-8px_color-mix(in_oklab,var(--accent-space)_40%,transparent),inset_0_1px_0_rgb(255_255_255/0.06)]',
                )}
              />
            )}
            <OmniboxContent tab={tab} reduced={reduced} paletteOpen={paletteOpen} />
            <LoadingBar show={tab.loading} reduced={reduced} />
          </>
        ) : (
          <>
            {hovered && (
              <motion.span
                layoutId="tab-hover"
                className="absolute inset-0 bg-accent"
                style={{ borderRadius: 10 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={reduced ? INSTANT : { ...spring.snappy, opacity: { duration: 0.12 } }}
              />
            )}
            <span className={cn('relative z-10 flex min-w-0 flex-1 items-center gap-2', iconOnly ? 'justify-center' : 'pr-1 pl-2.5')}>
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
                      'min-w-0 flex-1 overflow-hidden py-1 text-[12.5px] leading-none tracking-tight whitespace-nowrap text-zinc-400 transition-colors duration-150',
                      '[mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)] group-hover/tab:[mask-image:linear-gradient(to_right,#000_calc(100%-36px),transparent_calc(100%-20px))]',
                      'group-hover/tab:text-zinc-100 light:text-zinc-600 light:group-hover/tab:text-zinc-900',
                      tab.asleep && 'text-zinc-500 light:text-zinc-500',
                    )}
                  >
                    {tab.title || 'New Tab'}
                  </span>
                  <AudioButton tab={tab} className="transition-[margin,background-color,color] group-hover/tab:mr-6" />
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Close tab"
                    className={cn(
                      'absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-[opacity,background-color,color] duration-150',
                      'group-hover/tab:opacity-100 group-focus-visible/tab:opacity-100 hover:bg-white/10 hover:text-zinc-100 active:scale-[0.92]',
                      'light:text-zinc-500 light:hover:bg-black/[0.07] light:hover:text-zinc-900',
                    )}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      settle(vela().tabs.close(tab.id));
                    }}
                  >
                    <XIcon className="size-3.5" strokeWidth={2} />
                  </button>
                </>
              )}
            </span>
          </>
        )}
      </Reorder.Item>
    </TabContextMenu>
  );
}

function same(a: TabItemProps, b: TabItemProps): boolean {
  if (a.active !== b.active || a.hovered !== b.hovered || a.onHover !== b.onHover) return false;
  if (a.onDragStart !== b.onDragStart || a.onDragEnd !== b.onDragEnd || a.ref !== b.ref) return false;
  if (a.width !== b.width || a.compact !== b.compact) return false;
  if (a.active && a.paletteOpen !== b.paletteOpen) return false;
  const x = a.tab;
  const y = b.tab;
  if (x === y) return true;
  if (
    x.id !== y.id ||
    x.title !== y.title ||
    x.favicon !== y.favicon ||
    x.loading !== y.loading ||
    x.asleep !== y.asleep ||
    x.audible !== y.audible ||
    x.muted !== y.muted ||
    x.pinned !== y.pinned ||
    x.spaceId !== y.spaceId
  ) {
    return false;
  }
  if (!a.active) return x.url === y.url;
  return x.url === y.url && x.blockedCount === y.blockedCount && x.secure === y.secure;
}

export const TabItem = memo(TabItemImpl, same);
