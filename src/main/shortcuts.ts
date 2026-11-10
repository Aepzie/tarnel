import type { Input, WebContents } from 'electron';
import { IPC } from '../shared/ipc';
import { SPACE_COLORS, type UICommand } from '../shared/types';
import { getSettings, updateSettings } from './settings';
import { createSpace, getActiveSpaceId, listSpaces } from './spaces';
import {
  activateSpace,
  activateTabAt,
  closeTab,
  createTab,
  cycleTab,
  getActiveTab,
  getTabWebContents,
  goBack,
  goForward,
  reloadTab,
  reopenClosedTab,
  zoomTab,
} from './tabs';
import { getChromeView, getMainWindow, isHtmlFullscreen, sendToChrome, toggleFullscreen } from './window';
import { toggleSplit } from './split';
import { panic } from './panic';

const isMac = process.platform === 'darwin';

export function sendCommand(command: UICommand): void {
  const chrome = getChromeView()?.webContents;
  if (command !== 'escape' && chrome && !chrome.isDestroyed()) chrome.focus();
  sendToChrome(IPC.chromeEvents.command, command);
}

function withActive(fn: (id: number) => void): void {
  const id = getActiveTab();
  if (id !== null) fn(id);
}

function newBurnerSpace(): void {
  const color = SPACE_COLORS[listSpaces().length % SPACE_COLORS.length] ?? 'slate';
  const space = createSpace({ name: 'Burner', color, ephemeral: true });
  activateSpace(space.id);
}

function toggleDevTools(): void {
  withActive((id) => {
    const wc = getTabWebContents(id);
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  });
}

function openHistory(): void {
  createTab({ url: 'vela://history/', spaceId: getActiveSpaceId(), active: true });
}

/** Returns true when the input was handled (and should be swallowed). */
function handle(input: Input): boolean {
  const mod = isMac ? input.meta : input.control;
  const { shift, alt, code, key } = input;

  if (key === 'Escape' && shift && !mod && !alt) {
    if (!input.isAutoRepeat) sendCommand('task-manager');
    return true;
  }
  if (key === 'Escape') {
    if (isHtmlFullscreen()) {
      withActive((id) => {
        getTabWebContents(id)
          ?.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true)
          .catch(() => undefined);
      });
    }
    sendCommand('escape');
    return false;
  }
  // Held keys must not repeat destructive / spawning actions: the key is still swallowed, but the
  // action only runs on the first keyDown. Zoom, tab cycling and back/forward may repeat.
  const once = (fn: () => void): true => {
    if (!input.isAutoRepeat) fn();
    return true;
  };
  if (key === 'F12' || (mod && shift && code === 'KeyI')) return once(toggleDevTools);
  if (key === 'F11') return once(toggleFullscreen);
  if (key === 'F5') return once(() => withActive((id) => reloadTab(id, input.control || shift)));

  if (alt && !mod && !shift) {
    if (key === 'ArrowLeft') return withActive(goBack), true;
    if (key === 'ArrowRight') return withActive(goForward), true;
    if (code === 'KeyD') return once(() => sendCommand('focus-address'));
    return false;
  }
  if (!mod || alt) return false;

  if (code === 'Tab') return cycleTab(shift ? -1 : 1), true;
  if (/^Digit[1-9]$/.test(code) && !shift) {
    const n = Number(code.slice(5));
    return once(() => activateTabAt(n === 9 ? -1 : n - 1));
  }

  if (shift) {
    switch (code) {
      case 'KeyT':
        return once(reopenClosedTab);
      case 'KeyR':
        return once(() => withActive((id) => reloadTab(id, true)));
      case 'KeyN':
        return once(newBurnerSpace);
      case 'KeyS':
        return once(() => sendCommand('toggle-sidebar'));
      case 'Comma':
        return once(() => updateSettings({ tabLayout: getSettings().tabLayout === 'vertical' ? 'horizontal' : 'vertical' }));
      case 'KeyD':
        return once(() => {
          if (toggleSplit() !== null) sendCommand('command-palette');
        });
      case 'KeyM':
        return once(() => sendCommand('audio-mixer'));
      case 'Delete':
        return once(() => void panic());
      case 'Equal':
        withActive((id) => zoomTab(id, 1));
        return true;
      default:
        return false;
    }
  }

  switch (code) {
    case 'KeyT':
      return once(() => createTab({ spaceId: getActiveSpaceId(), active: true }));
    case 'KeyH':
      return once(openHistory);
    case 'KeyY':
      if (!isMac) return false;
      return once(openHistory);
    case 'KeyW':
      return once(() => withActive(closeTab));
    case 'KeyL':
      return once(() => sendCommand('focus-address'));
    case 'KeyK':
      return once(() => sendCommand('command-palette'));
    case 'KeyF':
      return once(() => sendCommand('find'));
    case 'KeyR':
      return once(() => withActive((id) => reloadTab(id)));
    case 'BracketLeft':
      if (!isMac) return false;
      withActive(goBack);
      return true;
    case 'BracketRight':
      if (!isMac) return false;
      withActive(goForward);
      return true;
    case 'Equal':
    case 'NumpadAdd':
      withActive((id) => zoomTab(id, 1));
      return true;
    case 'Minus':
    case 'NumpadSubtract':
      withActive((id) => zoomTab(id, -1));
      return true;
    case 'Digit0':
    case 'Numpad0':
      return once(() => withActive((id) => zoomTab(id, 0)));
    default:
      return false;
  }
}

/** vela://history uses Ctrl/Cmd+F to focus its own search field instead of the find bar. */
function ownsFindShortcut(wc: WebContents, input: Input): boolean {
  const mod = isMac ? input.meta : input.control;
  return mod && !input.shift && !input.alt && input.code === 'KeyF' && wc.getURL().startsWith('vela://history');
}

/** Capture browser shortcuts on any webContents (chrome UI or tab) regardless of focus. */
export function attachShortcuts(wc: WebContents): void {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !getMainWindow()) return;
    if (ownsFindShortcut(wc, input)) return;
    if (handle(input)) event.preventDefault();
  });
}
