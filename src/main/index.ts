import { app, type BaseWindow, protocol, session as electronSession } from 'electron';
import { IPC } from '../shared/ipc';
import { attachContextMenu } from './contextmenu';
import { attachDownloads } from './downloads';
import { registerIpc } from './ipc';
import { enableAdblockForSession, initAdblock, onBlocked } from './perf/adblock';
import { applyChromiumFlags } from './perf/flags';
import { initSleeper, stopSleeper } from './perf/sleeper';
import { chromePermissionPrompter } from './permissions';
import { applyGlobalUserAgent, setPermissionPrompter } from './privacy';
import { VELA_SCHEME, registerVelaProtocol } from './protocol';
import { getSettings, onSettingsChanged } from './settings';
import { attachShortcuts } from './shortcuts';
import { disposeEphemeralSpaces, getActiveSpaceId, initSpaces, onSessionCreated } from './spaces';
import { createStore, flushAllStores, type JsonStore } from './store';
import {
  activateSpace,
  createTab,
  getActiveTab,
  getBrowserState,
  initTabs,
  listSleepCandidates,
  noteBlocked,
  onStateChanged,
  onTabWebContents,
  restoreSession,
  serializeSession,
  sleepTab,
  type SavedTab,
} from './tabs';
import { resolveInput } from './url';
import { applyWindowMaterial, createMainWindow, getChromeView, getMainWindow, saveBounds, sendToChrome } from './window';

// Isolated profile for development/testing (separate single-instance lock + storage).
if (process.env.VELA_USER_DATA) app.setPath('userData', process.env.VELA_USER_DATA);

applyChromiumFlags();

// @ghostery/adblocker-electron fires cosmetic scriptlets with an un-awaited executeJavaScript();
// a scriptlet throwing on a page surfaces here as an unhandled rejection. It is harmless page-level
// noise, so it is swallowed — anything else is still reported.
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error && reason.message.startsWith('Script failed to execute')) return;
  console.error('[vela] unhandled rejection', reason);
});
protocol.registerSchemesAsPrivileged([
  { scheme: VELA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let sessionStore: JsonStore<SavedTab[]> | null = null;
let quitState: 'running' | 'disposing' | 'done' = 'running';
let booted = false;
const DISPOSE_TIMEOUT_MS = 2000;

function saveSession(): void {
  if (!booted || !sessionStore) return;
  sessionStore.set(serializeSession());
}

/** URLs passed on the command line (skips flags and the app path). */
function urlsFromArgv(argv: string[]): string[] {
  const engine = getSettings().searchEngine;
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((arg) => !arg.startsWith('-') && /^(https?:|vela:|file:)|\.(html?|pdf)$/i.test(arg))
    .map((arg) => resolveInput(arg, engine))
    .filter((url): url is string => !!url);
}

function openWindow(): BaseWindow {
  const win = createMainWindow();
  const chromeWc = getChromeView()?.webContents;
  if (chromeWc) {
    attachShortcuts(chromeWc);
    chromeWc.on('did-finish-load', () => sendToChrome(IPC.chromeEvents.state, getBrowserState()));
  }
  win.on('close', saveSession);
  initTabs(win);
  return win;
}

function focusWindow(): void {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!booted) return;
    if (!getMainWindow()) openWindow();
    for (const url of urlsFromArgv(argv)) createTab({ url, active: true });
    focusWindow();
  });

  app.on('web-contents-created', (_event, wc) => {
    wc.on('will-attach-webview', (event) => event.preventDefault());
  });

  void app.whenReady().then(() => {
    applyGlobalUserAgent();
    setPermissionPrompter(chromePermissionPrompter);
    electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    initSpaces();

    void initAdblock().catch(() => undefined);
    onSessionCreated((ses) => {
      registerVelaProtocol(ses);
      attachDownloads(ses);
      enableAdblockForSession(ses);
    });
    onBlocked((wcId) => noteBlocked(wcId));

    onTabWebContents((wc, tabId) => {
      attachShortcuts(wc);
      attachContextMenu(wc, tabId);
    });
    onStateChanged(() => {
      sendToChrome(IPC.chromeEvents.state, getBrowserState());
      saveSession();
    });
    let material = getSettings().windowMaterial;
    onSettingsChanged((settings) => {
      sendToChrome(IPC.chromeEvents.settings, settings);
      if (settings.windowMaterial !== material) {
        material = settings.windowMaterial;
        applyWindowMaterial(material);
      }
    });
    registerIpc();

    openWindow();

    sessionStore = createStore<SavedTab[]>('session', []);
    if (getSettings().restoreSession) restoreSession(sessionStore.get());
    else activateSpace(getActiveSpaceId());
    for (const url of urlsFromArgv(process.argv)) createTab({ url, active: true });
    booted = true;

    initSleeper({
      listTabs: listSleepCandidates,
      sleepTab,
      getSleepAfterMinutes: () => getSettings().sleepAfterMinutes,
    });
  });

  app.on('activate', () => {
    if (!booted || getMainWindow()) return;
    openWindow();
    if (getActiveTab() === null) activateSpace(getActiveSpaceId());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitState === 'done') return;
    event.preventDefault();
    if (quitState === 'disposing') return;
    quitState = 'disposing';
    stopSleeper();
    // Persist everything first so a slow/failed disposal can never lose state.
    try {
      saveSession();
      saveBounds();
      flushAllStores();
    } catch {
      /* still proceed with quitting */
    }
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, DISPOSE_TIMEOUT_MS));
    void Promise.race([disposeEphemeralSpaces().catch(() => undefined), timeout]).finally(() => {
      quitState = 'done';
      app.quit();
    });
  });
}
