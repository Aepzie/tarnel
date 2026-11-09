import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Bell, MapPin, Mic, Video, type LucideIcon } from 'lucide-react';
import type { PermissionRequest, Space, TabState } from '@shared/types';
import { Switch } from '@/components/ui/switch';
import { useBrowserState } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SPACE_HEX, settle, vela } from '@/lib/vela';
import { Favicon } from '../tabs/Favicon';
import { pickPermission, respondToPermission, usePermissionQueue } from './permission-store';

const CARD_WIDTH = 360;
const EDGE = 8;
const GAP = 10;
const CARET_INSET = 24;

interface Placement {
  left: number;
  top: number;
  caret: number;
}

function describe(request: PermissionRequest): { action: string; Icon: LucideIcon } {
  if (request.permission === 'geolocation') return { action: 'know your location', Icon: MapPin };
  if (request.permission === 'notifications') return { action: 'send notifications', Icon: Bell };
  const types = request.mediaTypes ?? ['video', 'audio'];
  const video = types.includes('video');
  const audio = types.includes('audio');
  if (video && audio) return { action: 'use your camera and microphone', Icon: Video };
  if (video) return { action: 'use your camera', Icon: Video };
  return { action: 'use your microphone', Icon: Mic };
}

function anchorFor(request: PermissionRequest, activeTabId: number | null): Element | null {
  const own = request.tabId !== null && request.tabId !== activeTabId ? document.querySelector(`[data-tab-id="${request.tabId}"]`) : null;
  return own ?? document.querySelector('[data-omnibox]');
}

function place(request: PermissionRequest, activeTabId: number | null): Placement {
  const maxLeft = Math.max(EDGE, window.innerWidth - CARD_WIDTH - EDGE);
  const rect = anchorFor(request, activeTabId)?.getBoundingClientRect();
  if (!rect || rect.width === 0) {
    return { left: Math.min(maxLeft, Math.max(EDGE, (window.innerWidth - CARD_WIDTH) / 2)), top: 56, caret: CARD_WIDTH / 2 };
  }
  const left = Math.min(maxLeft, Math.max(EDGE, rect.left));
  const target = rect.left + Math.min(CARET_INSET, rect.width / 2);
  const caret = Math.min(CARD_WIDTH - 20, Math.max(20, target - left));
  return { left, top: rect.bottom + GAP, caret };
}

/**
 * In-chrome site permission prompt: a glass popover anchored under the omnibox (or the requesting
 * background tab). One request at a time; Block is the safe default for focus and Esc.
 */
export function PermissionPrompt() {
  const queue = usePermissionQueue();
  const state = useBrowserState();
  const request = pickPermission(queue, state.activeTabId);
  useOverlayPresence(!!request);

  return (
    <AnimatePresence>
      {request && (
        <PermissionCard
          key={request.id}
          request={request}
          pendingCount={queue.length}
          activeTabId={state.activeTabId}
          tab={request.tabId === null ? undefined : state.tabs.find((tab) => tab.id === request.tabId)}
          spaces={state.spaces}
          activeSpaceId={state.activeSpaceId}
        />
      )}
    </AnimatePresence>
  );
}

interface CardProps {
  request: PermissionRequest;
  pendingCount: number;
  activeTabId: number | null;
  tab: TabState | undefined;
  spaces: Space[];
  activeSpaceId: string;
}

function PermissionCard({ request, pendingCount, activeTabId, tab, spaces, activeSpaceId }: CardProps) {
  const reduced = useReducedMotion();
  const blockRef = useRef<HTMLButtonElement>(null);
  const [remember, setRemember] = useState(false);
  const [placement, setPlacement] = useState<Placement>(() => place(request, activeTabId));

  const space = spaces.find((candidate) => candidate.id === (tab?.spaceId ?? activeSpaceId));
  const burner = space?.ephemeral === true;
  const background = request.tabId !== null && request.tabId !== activeTabId;
  const { action, Icon } = describe(request);

  const measure = useCallback(() => setPlacement(place(request, activeTabId)), [request, activeTabId]);

  useLayoutEffect(() => {
    measure();
    const settleTimer = window.setTimeout(measure, 320);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', measure);
    };
  }, [measure, tab?.id, spaces]);

  useEffect(() => {
    blockRef.current?.focus({ preventScroll: true });
  }, []);

  const answer = useCallback(
    (allow: boolean) => respondToPermission(request.id, allow, remember && !burner),
    [request.id, remember, burner],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      respondToPermission(request.id, false, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request.id]);

  const accent = space ? SPACE_HEX[space.color] : undefined;
  const style = { left: placement.left, top: placement.top, width: CARD_WIDTH, ...(accent ? { '--accent-space': accent } : {}) } as CSSProperties;

  return (
    <motion.div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`perm-title-${request.id}`}
      style={{ ...style, transformOrigin: `${placement.caret}px 0px` }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6, filter: 'blur(6px)' }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', transition: spring.soft }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6, filter: 'blur(4px)', transition: { duration: 0.16, ease: ease.out } }}
      className="no-drag fixed z-50 text-[13px] text-zinc-100 select-none light:text-zinc-900"
    >
      <span
        aria-hidden="true"
        style={{ left: placement.caret - 6 }}
        className="absolute -top-[6px] size-3 rotate-45 rounded-tl-[3px] border-t border-l border-[color-mix(in_oklab,var(--accent-space)_30%,rgb(255_255_255/0.08))] bg-zinc-900/90 backdrop-blur-2xl light:bg-white/90"
      />
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl bg-zinc-900/80 p-4 backdrop-blur-2xl light:bg-white/80',
          'shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-space)_30%,rgb(255_255_255/0.06)),0_18px_48px_-16px_rgb(0_0_0/0.65),0_8px_28px_-14px_color-mix(in_oklab,var(--accent-space)_45%,transparent),inset_0_1px_0_rgb(255_255_255/0.06)]',
        )}
      >
        {background && tab && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/[0.04] py-1.5 pr-1.5 pl-2 light:bg-black/[0.04]">
            <Favicon src={tab.favicon} url={tab.url} title={tab.title} asleep={tab.asleep} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-400 light:text-zinc-600">{tab.title || request.host}</span>
            <button
              type="button"
              onClick={() => settle(vela().tabs.activate(tab.id))}
              className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[12px] font-medium text-space transition-colors duration-150 outline-none hover:bg-space/12 focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Switch to tab
              <ArrowUpRight className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        )}

        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-space/14 text-space ring-1 ring-space/25">
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1 pt-px">
            <p id={`perm-title-${request.id}`} className="leading-snug tracking-tight text-zinc-300 light:text-zinc-600">
              <span className="font-medium break-all text-zinc-100 light:text-zinc-900">{request.host}</span> wants to{' '}
              <span className="font-semibold text-zinc-50 light:text-zinc-950">{action}</span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-zinc-500">
              <span className="size-1.5 shrink-0 rounded-full bg-space" />
              <span className="truncate">{burner ? 'Burner Space — forgotten when closed' : `Only in Space · ${space?.name ?? 'this Space'}`}</span>
            </p>
          </div>
          {pendingCount > 1 && (
            <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-zinc-400 tabular-nums light:bg-black/[0.05]">
              +{pendingCount - 1}
            </span>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          {!burner && (
            <label className="mr-auto flex cursor-default items-center gap-2 text-[12px] text-zinc-400 light:text-zinc-600">
              <Switch size="sm" checked={remember} onCheckedChange={setRemember} />
              Remember for this site
            </label>
          )}
          <button
            ref={blockRef}
            type="button"
            onClick={() => answer(false)}
            className={cn(
              'h-8 rounded-[8px] px-3.5 font-medium text-zinc-300 transition-colors duration-150 outline-none active:scale-[0.96] light:text-zinc-700',
              'hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[var(--ring)] light:hover:bg-black/[0.06]',
              burner && 'ml-auto',
            )}
          >
            Block
          </button>
          <button
            type="button"
            onClick={() => answer(true)}
            className="h-8 rounded-[8px] bg-space px-4 font-medium text-zinc-950 transition-[filter,transform] duration-150 outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 active:scale-[0.96]"
          >
            Allow
          </button>
        </div>
      </div>
    </motion.div>
  );
}
