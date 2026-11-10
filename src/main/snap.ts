import { screen, type BaseWindow } from 'electron';
import { snapBounds, snapZone } from './snap-zone';

/**
 * Electron strips WS_THICKFRAME / WS_CAPTION from `transparent` windows on Windows, which turns off
 * native Snap (drag to an edge). The caption drag itself is still the native move loop, so emulate
 * the drag-to-edge part when it ends ('moved' only fires for user moves, not setBounds). Returns
 * whether the window was snapped.
 */
export function emulateDragSnap(win: BaseWindow): boolean {
  if (win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return false;
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const zone = snapZone(point, display.bounds);
  if (!zone) return false;
  if (zone === 'maximize') win.maximize();
  else win.setBounds(snapBounds(zone, display.workArea));
  return true;
}
