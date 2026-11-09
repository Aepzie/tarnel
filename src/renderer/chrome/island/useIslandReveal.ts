import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { UICommand } from '@shared/types';
import { useCommand } from '@/hooks/browser';
import { useOverlay } from '@/hooks/overlay';
import { ui } from '../ui-store';

const HIDE_DELAY_MS = 400;
/** Open surfaces anchored to the island (menus, popovers, dialogs) keep it revealed. */
const BLOCKING_SELECTOR =
  '[data-radix-popper-content-wrapper] [role="menu"], [data-radix-popper-content-wrapper] [role="dialog"], [data-radix-popper-content-wrapper] [role="listbox"], [data-radix-popper-content-wrapper] [role="tooltip"], [data-slot="tooltip-content"], [role="dialog"], [role="alertdialog"]';

interface IslandReveal {
  /** Island is on screen (always in normal mode; while revealed in focus mode). */
  visible: boolean;
  onEdgeEnter: () => void;
  onIslandEnter: () => void;
  onLeave: () => void;
  /** Call when the island finished an enter/exit animation. */
  onSettled: () => void;
}

/**
 * Focus-mode reveal controller. Hovering the top hot edge reveals the island as a floating overlay;
 * it hides 400ms after the pointer leaves (unless a menu/palette anchored to it is open), on window
 * blur and on Escape. Holds the overlay until the exit animation finishes so the page doesn't cut
 * the slide-out short.
 */
export function useIslandReveal(
  autoHide: boolean,
  revealed: boolean,
  paletteOpen: boolean,
  islandRef: RefObject<HTMLElement | null>,
): IslandReveal {
  const timer = useRef<number | undefined>(undefined);
  const paletteRef = useRef(paletteOpen);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    paletteRef.current = paletteOpen;
  }, [paletteOpen]);

  const cancel = useCallback((): void => window.clearTimeout(timer.current), []);

  const reveal = useCallback((): void => {
    cancel();
    ui.setIslandRevealed(true);
  }, [cancel]);

  const hideNow = useCallback((): void => {
    cancel();
    if (paletteRef.current) return;
    ui.setIslandRevealed(false);
  }, [cancel]);

  const scheduleHide = useCallback((): void => {
    if (!ui.get().islandRevealed) return;
    cancel();
    const tick = (): void => {
      if (paletteRef.current || islandRef.current?.matches(':hover')) return;
      if (document.querySelector(BLOCKING_SELECTOR)) {
        timer.current = window.setTimeout(tick, HIDE_DELAY_MS);
        return;
      }
      ui.setIslandRevealed(false);
    };
    timer.current = window.setTimeout(tick, HIDE_DELAY_MS);
  }, [cancel, islandRef]);

  useEffect(() => {
    if (autoHide) return;
    cancel();
    ui.setIslandRevealed(false);
    setSettling(false);
  }, [autoHide, cancel]);

  useEffect(() => {
    if (!autoHide) return;
    if (paletteOpen) reveal();
    else if (!islandRef.current?.matches(':hover')) scheduleHide();
  }, [autoHide, paletteOpen, reveal, scheduleHide, islandRef]);

  useEffect(() => {
    if (autoHide && revealed) setSettling(true);
  }, [autoHide, revealed]);

  useEffect(() => {
    if (!autoHide) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hideNow();
    };
    const root = document.documentElement;
    window.addEventListener('blur', scheduleHide);
    window.addEventListener('keydown', onKey);
    root.addEventListener('pointerleave', scheduleHide);
    return () => {
      window.removeEventListener('blur', scheduleHide);
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerleave', scheduleHide);
    };
  }, [autoHide, hideNow, scheduleHide]);

  useEffect(() => cancel, [cancel]);

  // Main swallows Escape and forwards it as a command. The palette closes on the same command, so
  // only hide if the palette was not open at the time (paletteRef lags one render behind on purpose).
  const onCommand = useCallback(
    (command: UICommand): void => {
      if (command === 'escape' && autoHide) hideNow();
    },
    [autoHide, hideNow],
  );
  useCommand(onCommand);

  useOverlay(autoHide && (revealed || settling));

  const onSettled = useCallback((): void => {
    if (!ui.get().islandRevealed) setSettling(false);
  }, []);

  return {
    visible: !autoHide || revealed,
    onEdgeEnter: reveal,
    onIslandEnter: cancel,
    onLeave: scheduleHide,
    onSettled,
  };
}
