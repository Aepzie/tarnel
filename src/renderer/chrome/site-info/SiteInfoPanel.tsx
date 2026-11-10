import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bell, Cookie, Lock, MapPin, Mic, RotateCcw, Shield, TriangleAlert, Video, type LucideIcon } from 'lucide-react';
import type { SiteCloseAction, SiteInfo, SitePermission, SitePermissionKey } from '@shared/site-data';
import { useActiveSpace } from '@/hooks/browser';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SPACE_HEX, vela } from '@/lib/vela';

const PANEL_WIDTH = 320;
const EDGE = 8;
const GAP = 8;

const PERMISSION_LABEL: Record<SitePermissionKey, { label: string; Icon: LucideIcon }> = {
  'media:video': { label: 'Camera', Icon: Video },
  'media:audio': { label: 'Microphone', Icon: Mic },
  geolocation: { label: 'Location', Icon: MapPin },
  notifications: { label: 'Notifications', Icon: Bell },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * The palette's lock/host chip as a button that opens the site info popover. The popover is
 * portalled (the palette surface is transformed while it animates) and lives inside the palette's
 * overlay, so the page view never covers it.
 */
export function SiteInfoTrigger({ tabId, title, children }: { tabId: number; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((value) => !value)}
        className="no-drag flex shrink-0 items-center gap-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        {children}
      </button>
      {createPortal(
        <AnimatePresence>{open && <SiteInfoPanel key={tabId} tabId={tabId} anchor={anchorRef} onClose={() => setOpen(false)} />}</AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function placeUnder(anchor: HTMLElement | null): { left: number; top: number } {
  const rect = anchor?.getBoundingClientRect();
  if (!rect) return { left: EDGE, top: 64 };
  const left = Math.min(window.innerWidth - PANEL_WIDTH - EDGE, Math.max(EDGE, rect.right - PANEL_WIDTH));
  return { left, top: rect.bottom + GAP };
}

function SiteInfoPanel({ tabId, anchor, onClose }: { tabId: number; anchor: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const space = useActiveSpace();
  const [info, setInfo] = useState<SiteInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [position, setPosition] = useState(() => placeUnder(anchor.current));

  useLayoutEffect(() => {
    const measure = (): void => setPosition(placeUnder(anchor.current));
    measure();
    const settleTimer = window.setTimeout(measure, 280);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', measure);
    };
  }, [anchor]);

  useEffect(() => {
    let live = true;
    vela()
      .site.info(tabId)
      .then((next) => live && setInfo(next))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [tabId]);

  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [anchor, onClose]);

  const apply = useCallback((action: Promise<SiteInfo | null>) => {
    setBusy(true);
    action
      .then((next) => setInfo(next))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onClose();
    anchor.current?.focus({ preventScroll: true });
  };

  const accent = space ? SPACE_HEX[space.color] : undefined;
  const style = { left: position.left, top: position.top, width: PANEL_WIDTH, ...(accent ? { '--accent-space': accent } : {}) } as CSSProperties;

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-label="Site information"
      style={{ ...style, transformOrigin: `${PANEL_WIDTH - 24}px 0px` }}
      onKeyDown={onKeyDown}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0, transition: spring.soft }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.14, ease: ease.out } }}
      className={cn(
        'no-drag fixed z-[110] overflow-hidden rounded-xl bg-zinc-900/90 text-[12.5px] text-zinc-200 backdrop-blur-2xl select-none light:bg-white/90 light:text-zinc-800',
        'shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_18px_48px_-16px_rgb(0_0_0/0.65),inset_0_1px_0_rgb(255_255_255/0.05)] light:shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_18px_48px_-16px_rgb(0_0_0/0.3)]',
      )}
    >
      {info === undefined && <div className="px-4 py-5 text-center text-zinc-500">Loading…</div>}
      {info === null && <div className="px-4 py-5 text-center text-zinc-500">No site information for this page.</div>}
      {info && (
        <SiteInfoBody
          info={info}
          busy={busy}
          confirmClear={confirmClear}
          onAskClear={() => setConfirmClear(true)}
          onCancelClear={() => setConfirmClear(false)}
          onClear={() => {
            setConfirmClear(false);
            apply(vela().site.clear(tabId));
          }}
          onReset={(key) => apply(vela().site.resetPermission(tabId, key))}
          onSetOnClose={(action) => apply(vela().site.setOnClose(tabId, action))}
        />
      )}
    </motion.div>
  );
}

interface BodyProps {
  info: SiteInfo;
  busy: boolean;
  confirmClear: boolean;
  onAskClear: () => void;
  onCancelClear: () => void;
  onClear: () => void;
  onReset: (key: SitePermissionKey) => void;
  onSetOnClose: (action: SiteCloseAction) => void;
}

const sectionCls = 'border-t border-white/[0.06] px-4 py-3 light:border-black/[0.06]';
const ghostBtn =
  'inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-zinc-300 transition-colors duration-150 outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50 light:text-zinc-700 light:hover:bg-black/[0.06]';

function SiteInfoBody({ info, busy, confirmClear, onAskClear, onCancelClear, onClear, onReset, onSetOnClose }: BodyProps) {
  const insecure = !info.secure && info.origin.startsWith('http:');
  const storage = info.storageBytes !== null && info.storageBytes > 0 ? ` · ${formatBytes(info.storageBytes)} stored` : '';
  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-3">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium tracking-tight text-zinc-50 light:text-zinc-950">{info.host}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-zinc-500">
          <span className="size-1.5 rounded-full bg-space" />
          <span className="max-w-28 truncate">{info.spaceName}</span>
        </span>
      </div>

      <Line Icon={insecure ? TriangleAlert : Lock} tone={insecure ? 'warn' : 'muted'}>
        {info.secure ? 'Connection is secure' : insecure ? 'Connection is not secure' : 'Connection security unknown'}
        <span className="block text-[11.5px] text-zinc-500">
          {info.secure ? 'Certificate valid · encrypted with TLS' : insecure ? 'Information you send can be read by others.' : 'Vela could not verify this connection.'}
        </span>
      </Line>
      <Line Icon={Shield} tone="muted">
        {info.blockedCount === 0 ? 'No trackers blocked on this page' : `${info.blockedCount} tracker${info.blockedCount === 1 ? '' : 's'} blocked on this page`}
      </Line>

      {info.permissions.length > 0 && (
        <div className={sectionCls}>
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-zinc-500">Permissions</p>
          {info.permissions.map((permission) => (
            <PermissionLine key={permission.key} permission={permission} busy={busy} onReset={() => onReset(permission.key)} />
          ))}
        </div>
      )}

      <div className={sectionCls}>
        <div className="flex items-center gap-2.5">
          <Cookie className="size-4 shrink-0 text-zinc-400" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">
            {info.cookies} cookie{info.cookies === 1 ? '' : 's'}
            <span className="text-zinc-500">{storage}</span>
          </span>
          {confirmClear ? (
            <span className="flex shrink-0 items-center gap-1">
              <button type="button" className={ghostBtn} onClick={onCancelClear}>
                Cancel
              </button>
              <button type="button" className={cn(ghostBtn, 'text-red-400 hover:bg-red-500/10 light:text-red-600')} onClick={onClear} autoFocus>
                Clear
              </button>
            </span>
          ) : (
            <button type="button" className={ghostBtn} disabled={busy} onClick={onAskClear}>
              Clear site data
            </button>
          )}
        </div>
        {info.ephemeral ? (
          <p className="mt-2 text-[11.5px] text-zinc-500">Burner Space — everything is forgotten when it closes.</p>
        ) : (
          <div className="mt-2.5 flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[12px] text-zinc-400 light:text-zinc-600">When Vela closes</span>
            <div role="radiogroup" aria-label="When Vela closes" className="flex shrink-0 rounded-lg bg-white/[0.05] p-0.5 ring-1 ring-white/[0.06] light:bg-black/[0.04] light:ring-black/[0.06]">
              {(['keep', 'clear'] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  role="radio"
                  aria-checked={info.onClose === action}
                  disabled={busy}
                  onClick={() => onSetOnClose(action)}
                  className={cn(
                    'h-6 rounded-md px-2 text-[11.5px] font-medium text-zinc-400 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] light:text-zinc-600',
                    info.onClose === action && 'bg-white/[0.1] text-zinc-100 light:bg-white light:text-zinc-900 light:shadow-sm',
                  )}
                >
                  {action === 'keep' ? 'Keep data' : 'Delete data'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Line({ Icon, tone, children }: { Icon: LucideIcon; tone: 'muted' | 'warn'; children: ReactNode }) {
  return (
    <div className={cn(sectionCls, 'flex items-start gap-2.5')}>
      <Icon className={cn('mt-px size-4 shrink-0', tone === 'warn' ? 'text-amber-400/90 light:text-amber-600' : 'text-zinc-400')} strokeWidth={1.75} />
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
    </div>
  );
}

function PermissionLine({ permission, busy, onReset }: { permission: SitePermission; busy: boolean; onReset: () => void }) {
  const { label, Icon } = PERMISSION_LABEL[permission.key];
  return (
    <div className="flex h-7 items-center gap-2.5">
      <Icon className="size-4 shrink-0 text-zinc-400" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn('text-[11.5px]', permission.allowed ? 'text-space' : 'text-zinc-500')}>{permission.allowed ? 'Allowed' : 'Blocked'}</span>
      <button type="button" className={ghostBtn} disabled={busy} onClick={onReset} title={permission.allowed ? 'Revoke' : 'Reset'}>
        <RotateCcw className="size-3" strokeWidth={2} />
        {permission.allowed ? 'Revoke' : 'Reset'}
      </button>
    </div>
  );
}
