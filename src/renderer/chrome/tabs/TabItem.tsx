import { memo, useRef, type MouseEvent, type PointerEvent, type Ref } from 'react';
import { AnimatePresence, Reorder, motion, useReducedMotion, type Transition } from 'motion/react';
import { CompassIcon, InfoIcon, LockIcon, SearchIcon, ShieldIcon, TriangleAlertIcon } from 'lucide-react';
import type { TabState } from '@shared/types';
import { cn } from '@/lib/utils';
import { spring } from '@/lib/motion';
import { addressSeed, formatCount, isInternalUrl, isNewTabUrl, settle, vela } from '@/lib/vela';
import { ui } from '../ui-store';
import { TabAudioButton } from '../audio/TabAudioButton';
import { TabContextMenu } from './TabContextMenu';
import { ACTIVE_TAB_SURFACE, TabFace, tabTooltip } from './TabFace';
import { TabFlag } from '../vpn/TabFlag';

export const PILL_MIN = 36;
export const PILL_MAX = 200;
/** Below this pills only show the favicon. */
export const PILL_ICON_ONLY = 56;

const INSTANT: Transition = { duration: 0 };

/** Omnibox pill fill + space-tinted glow (also used by the vertical layout's standalone omnibox). */
export const OMNIBOX_SURFACE = cn(
  'absolute inset-0 bg-white/[0.06] ring-1 ring-white/10 transition-colors duration-150 hover:bg-white/[0.08]',
  'light:bg-black/[0.04] light:ring-black/[0.07] light:hover:bg-black/[0.06]',
  'shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-space)_35%,transparent),0_8px_24px_-8px_color-mix(in_oklab,var(--accent-space)_40%,transparent),inset_0_1px_0_rgb(255_255_255/0.06)]',
);

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
  /** Hex color of the tab's group: drawn as an underline that links the group's tabs. */
  groupColor?: string;
  /** Last visible tab of its group: the underline stops at the tab's edge. */
  groupEnd?: boolean;
  ref?: Ref<HTMLDivElement>;
}

export interface Address {
  host: string;
  path: string;
  internal: boolean;
  empty: boolean;
}

export function parseAddress(tab: TabState): Address {
  const url = tab.url;
  if (!url || isNewTabUrl(url) || url === 'about:blank') return { host: '', path: '', internal: false, empty: true };
  if (isInternalUrl(url)) return { host: tab.title || url, path: '', internal: true, empty: false };
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

export function SecurityIcon({ tab, address }: { tab: TabState; address: Address }) {
  const cls = 'size-[15px] shrink-0';
  if (address.empty) return <SearchIcon className={cn(cls, 'text-zinc-400 light:text-zinc-500')} strokeWidth={1.75} />;
  if (address.internal) return <CompassIcon className={cn(cls, 'text-space')} strokeWidth={1.75} />;
  if (tab.secure) return <LockIcon className={cn(cls, 'text-zinc-400 light:text-zinc-500')} strokeWidth={1.75} />;
  if (tab.url.startsWith('http:')) return <TriangleAlertIcon className={cn(cls, 'text-amber-400/90 light:text-amber-600')} strokeWidth={1.75} />;
  return <InfoIcon className={cn(cls, 'text-zinc-400 light:text-zinc-500')} strokeWidth={1.75} />;
}

export function BlockedBadge({ count, reduced }: { count: number; reduced: boolean }) {
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

/** Speaker / microphone indicator; opens the tab's sound popover. */
export const AudioButton = TabAudioButton;

export function OmniboxContent({ tab, reduced, paletteOpen }: { tab: TabState; reduced: boolean; paletteOpen: boolean }) {
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

export function LoadingBar({ show, reduced }: { show: boolean; reduced: boolean }) {
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

/** Raised fill of the active tab; hands `layoutId="omnibox"` to the palette while it is open. */
export function ActiveSurface({ paletteOpen, reduced }: { paletteOpen: boolean; reduced: boolean }) {
  if (paletteOpen) {
    return <span className="absolute inset-0 rounded-[10px] bg-white/[0.03] ring-1 ring-white/[0.06] light:bg-black/[0.03] light:ring-black/[0.05]" />;
  }
  return <motion.span layoutId="omnibox" transition={reduced ? INSTANT : spring.snappy} style={{ borderRadius: 10 }} className={ACTIVE_TAB_SURFACE} />;
}

/** Group membership line under a tab; bridges the 4px gap to the next tab unless it ends the group. */
function GroupUnderline({ color, end, reduced }: { color: string; end: boolean; reduced: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      className={cn('pointer-events-none absolute -bottom-[3px] left-0 h-[2px]', end ? 'right-1 rounded-r-full' : '-right-1')}
      style={{ backgroundColor: color, transformOrigin: 'left' }}
      initial={reduced ? false : { scaleX: 0, opacity: 0 }}
      animate={{ scaleX: 1, opacity: 0.75 }}
      transition={reduced ? INSTANT : spring.snappy}
    />
  );
}

/**
 * One tab pill. Active and inactive tabs share the same width (Chrome-style); the active one gets a
 * raised fill that morphs into the palette, and an always-visible close button. Memoized on the
 * fields it renders.
 */
function TabItemImpl({ tab, active, hovered, paletteOpen, onHover, onDragStart, onDragEnd, width, compact = false, groupColor, groupEnd = false, ref }: TabItemProps) {
  const reduced = !!useReducedMotion();
  const dragged = useRef(false);
  /** Whether this tab was already active when the primary button went down; only then may the click open the palette. */
  const wasActive = useRef(false);
  const iconOnly = tab.pinned || compact;
  const minWidth = PILL_MIN;
  const maxWidth = iconOnly ? PILL_MIN : PILL_MAX;
  const sized = width !== undefined;
  const targetWidth = iconOnly ? PILL_MIN : width;
  const layoutTransition = reduced ? INSTANT : spring.snappy;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    dragged.current = false;
    wasActive.current = e.button === 0 && active;
    if (e.button !== 0) return;
    if (!active) settle(vela().tabs.activate(tab.id));
  };

  const onClick = (): void => {
    const opensPalette = wasActive.current && !dragged.current;
    dragged.current = false;
    wasActive.current = false;
    if (opensPalette) ui.openPalette('current', addressSeed(tab.url));
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
        title={tabTooltip(tab, active)}
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
          sized ? 'shrink-0' : 'shrink',
        )}
      >
        {groupColor && <GroupUnderline color={groupColor} end={groupEnd} reduced={reduced} />}
        {active && <ActiveSurface paletteOpen={paletteOpen} reduced={reduced} />}
        {!active && hovered && (
          <motion.span
            layoutId="tab-hover"
            className="absolute inset-0 bg-accent"
            style={{ borderRadius: 10 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduced ? INSTANT : { ...spring.snappy, opacity: { duration: 0.12 } }}
          />
        )}
        <TabFlag tab={tab} />
        <TabFace tab={tab} active={active} iconOnly={iconOnly} />
      </Reorder.Item>
    </TabContextMenu>
  );
}

function same(a: TabItemProps, b: TabItemProps): boolean {
  if (a.active !== b.active || a.hovered !== b.hovered || a.onHover !== b.onHover) return false;
  if (a.onDragStart !== b.onDragStart || a.onDragEnd !== b.onDragEnd || a.ref !== b.ref) return false;
  if (a.width !== b.width || a.compact !== b.compact) return false;
  if (a.groupColor !== b.groupColor || a.groupEnd !== b.groupEnd) return false;
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
    x.micActive !== y.micActive ||
    x.vpn !== y.vpn ||
    !x.devices !== !y.devices ||
    x.pinned !== y.pinned ||
    x.spaceId !== y.spaceId
  ) {
    return false;
  }
  if (!a.active) return x.url === y.url;
  return x.url === y.url && x.blockedCount === y.blockedCount && x.secure === y.secure;
}

export const TabItem = memo(TabItemImpl, same);
