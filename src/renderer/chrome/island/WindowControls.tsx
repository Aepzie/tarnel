import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Minus, Plus, X } from 'lucide-react';
import { ease } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { settle } from '@/lib/vela';

function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let alive = true;
    void window.vela.window.isMaximized().then((value) => {
      if (alive) setMaximized(value);
    });
    const off = window.vela.window.onMaximizedChange(setMaximized);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return maximized;
}

function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = (): void => setFocused(true);
    const off = (): void => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return focused;
}

/* ---------------------------------------------------------------- Windows caption buttons */

/** Windows 11-style hairline glyphs drawn on a 10px grid so every stroke lands on a whole pixel. */
const Glyph = ({ children }: { children: ReactNode }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
    {children}
  </svg>
);

const MinimizeGlyph = () => (
  <Glyph>
    <path d="M0 5.5h10" shapeRendering="crispEdges" />
  </Glyph>
);

const MaximizeGlyph = () => (
  <Glyph>
    <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
  </Glyph>
);

const RestoreGlyph = () => (
  <Glyph>
    <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
    <path d="M2.5 2.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
  </Glyph>
);

const CloseGlyph = () => (
  <Glyph>
    <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
  </Glyph>
);

const captionClass = cn(
  'no-drag inline-flex h-7 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none',
  'transition-[background-color,color] duration-120 ease-out',
  'hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
);

export function CaptionButtons() {
  const maximized = useMaximized();
  const reduce = useReducedMotion();
  const swap = reduce
    ? { initial: { opacity: 0 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, scale: 0.7 }, exit: { opacity: 0, scale: 0.7 } };

  return (
    <div className="no-drag flex shrink-0 items-center gap-1">
      <button type="button" aria-label="Minimize" className={captionClass} onClick={() => settle(window.vela.window.minimize())}>
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        className={captionClass}
        onClick={() => settle(window.vela.window.toggleMaximize())}
      >
        <span className="grid place-items-center">
          <AnimatePresence initial={false}>
            <motion.span
              key={maximized ? 'restore' : 'maximize'}
              className="col-start-1 row-start-1 flex"
              initial={swap.initial}
              animate={{ opacity: 1, scale: 1 }}
              exit={swap.exit}
              transition={{ duration: 0.16, ease: ease.out }}
            >
              {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>
      <button
        type="button"
        aria-label="Close window"
        className={cn(captionClass, 'hover:bg-[#e81123] hover:text-white active:bg-[#c50f1f] active:text-white')}
        onClick={() => settle(window.vela.window.close())}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- macOS traffic lights */

const LIGHTS = [
  { key: 'close', label: 'Close window', color: 'bg-[#ff5f57]', idle: 'group-hover/traffic:bg-[#ff5f57]', Icon: X, run: () => window.vela.window.close() },
  { key: 'min', label: 'Minimize', color: 'bg-[#febc2e]', idle: 'group-hover/traffic:bg-[#febc2e]', Icon: Minus, run: () => window.vela.window.minimize() },
  { key: 'zoom', label: 'Zoom', color: 'bg-[#28c840]', idle: 'group-hover/traffic:bg-[#28c840]', Icon: Plus, run: () => window.vela.window.toggleMaximize() },
] as const;

export function TrafficLights() {
  const focused = useWindowFocused();
  return (
    <div className="group/traffic no-drag flex shrink-0 items-center gap-2 px-1">
      {LIGHTS.map(({ key, label, color, idle, Icon, run }) => (
        <button
          key={key}
          type="button"
          aria-label={label}
          onClick={() => void run()}
          className={cn(
            'relative grid size-3 place-items-center rounded-full outline-none transition-colors duration-120',
            'shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.18)] focus-visible:ring-2 focus-visible:ring-ring',
            focused ? color : cn('bg-foreground/15', idle),
          )}
        >
          <Icon
            size={8}
            strokeWidth={2.5}
            className="text-black/60 opacity-0 transition-opacity duration-120 group-hover/traffic:opacity-100"
          />
        </button>
      ))}
    </div>
  );
}

/** Platform-appropriate window controls. Callers place them (right on Windows/Linux, left on macOS). */
export function WindowControls() {
  return window.vela?.platform === 'darwin' ? <TrafficLights /> : <CaptionButtons />;
}
