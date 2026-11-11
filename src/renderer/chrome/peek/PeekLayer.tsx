import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeftIcon, Columns2Icon, LoaderCircleIcon, PanelTopIcon, RotateCwIcon, XIcon } from 'lucide-react';
import { peekGeometry, peekHost, PEEK_CLOSED, PEEK_TOOLBAR, type PeekState } from '@shared/peek';
import { useOverlayPresence } from '@/hooks/overlay';
import { ease } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { settle, vela } from '@/lib/vela';
import { useViewportRect } from '../viewport-rect';

const OPEN_S = 0.2;
const CLOSE_S = 0.15;

function usePeekState(): PeekState {
  const [state, setState] = useState<PeekState>(PEEK_CLOSED);
  useEffect(() => vela().peek.onState(setState), []);
  return state;
}

/**
 * Peek frame: dimmed backdrop over the window and the card (toolbar + rounded frame) whose lower part
 * main fills with the preview's page view once the open animation has run (`peek.reveal`). Holds the
 * overlay while open so the chrome stays raised above the tab underneath.
 */
export function PeekLayer() {
  const state = usePeekState();
  const area = useViewportRect();
  const reduced = !!useReducedMotion();
  useOverlayPresence(state.open, CLOSE_S * 1000 + 40);

  useEffect(() => {
    if (!state.open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      settle(vela().peek.close());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.open]);

  useEffect(() => {
    if (state.open && reduced) settle(vela().peek.reveal());
  }, [state.open, reduced]);

  const card = area ? peekGeometry(area).card : null;

  return createPortal(
    <AnimatePresence>
      {state.open && card && (
        <motion.div
          key="peek"
          className="fixed inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : CLOSE_S, ease: ease.out }}
        >
          <div
            aria-hidden="true"
            className="no-drag absolute inset-0 bg-black/45 light:bg-black/25"
            onPointerDown={() => settle(vela().peek.close())}
          />
          <motion.div
            role="dialog"
            aria-label={`Peek: ${peekHost(state.url)}`}
            className="no-drag absolute flex flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground ring-1 ring-white/10 light:ring-black/10"
            style={{ left: card.x, top: card.y, width: card.width, height: card.height, transformOrigin: '50% 40%' }}
            initial={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            transition={{ duration: reduced ? 0 : OPEN_S, ease: ease.out }}
            onAnimationComplete={() => {
              if (!reduced) settle(vela().peek.reveal());
            }}
          >
            <PeekToolbar state={state} />
            <div className="flex-1 bg-white" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function PeekToolbar({ state }: { state: PeekState }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 px-1.5" style={{ height: PEEK_TOOLBAR }}>
      <ToolbarButton label="Back" disabled={!state.canGoBack} onClick={() => settle(vela().peek.back())}>
        <ArrowLeftIcon className="size-[15px]" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton label="Reload" onClick={() => settle(vela().peek.reload())}>
        {state.loading ? (
          <LoaderCircleIcon className="size-[15px] animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
        ) : (
          <RotateCwIcon className="size-[15px]" strokeWidth={1.75} />
        )}
      </ToolbarButton>
      <div className="mx-2 min-w-0 flex-1 truncate text-center text-[12px] text-muted-foreground" title={state.url}>
        <span className="text-foreground">{peekHost(state.url) || 'Loading…'}</span>
        {state.title && <span className="ml-2">{state.title}</span>}
      </div>
      <button
        type="button"
        onClick={() => settle(vela().peek.toTab())}
        className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-zinc-300 outline-none transition-colors duration-150 hover:bg-accent hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-[var(--ring)] light:text-zinc-600 light:hover:text-zinc-900"
      >
        <PanelTopIcon className="size-[14px]" strokeWidth={1.75} />
        Open as tab
      </button>
      <ToolbarButton label="Open in split view" onClick={() => settle(vela().peek.toSplit())}>
        <Columns2Icon className="size-[15px]" strokeWidth={1.75} />
      </ToolbarButton>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-white/10 light:bg-black/10" />
      <ToolbarButton label="Close (Esc)" onClick={() => settle(vela().peek.close())}>
        <XIcon className="size-[15px]" strokeWidth={1.75} />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-full text-zinc-400 outline-none transition-colors duration-150 hover:bg-accent hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-[var(--ring)] active:scale-[0.94] light:text-zinc-500 light:hover:text-zinc-900',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
