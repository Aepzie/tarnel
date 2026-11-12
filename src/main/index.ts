import { app, type BaseWindow, protocol, session as electronSession, webContents } from 'electron';
import { configureDrmStartup, initDrm, isSettingsPage } from './drm';
import { DRM_PROBE_SCHEME } from './drm/probe-scheme';
import { flushCompileCache } from 'node:module';
import { IPC } from '../shared/ipc';
import { attachContextMenu } from './contextmenu';
import { attachDownloads } from './downloads';
import { initFingerprint } from './fingerprint';
import { initIdentity } from './identity';
import { initUserAgent } from './user-agent';
import { initSiteRules } from './site-rules';
import { initAudioDevices } from './audio-devices';
import { initAudioMixer } from './audio-mixer';
import { initExtensions } from './extensions';
import { initPasswords } from './passwords';
import { getCookieBannerStats, initCookieBanners } from './cookie-banners';
import { registerIpc } from './ipc';
import { initPageTheme } from './page-theme';
import { enableAdblockForSession, initAdblock, onBlocked } from './perf/adblock';
import { initAdblockEarly } from './perf/adblock-early';
import { applyChromiumFlags } from './perf/flags';
import { initFrameRate } from './perf/frame-rate';
import { initSleeper, stopSleeper, trackDownloadsForSleep } from './perf/sleeper';
import { runAutoArchive } from './tab-archive';
import { initBatterySaver } from './perf/battery-saver';
import { initSecureDns } from './dns';
import { chromePermissionPrompter } from './permissions';
import { applyGlobalUserAgent, onTrackingStripped, setPermissionPrompter } from './privacy';
import { INTERNAL_SCHEME, LEGACY_INTERNAL_SCHEME, registerInternalProtocol } from './protocol';
import { attachSafety, initSafety } from './safety';
import { getSettings, onSettingsChanged } from './settings';
import { clearSiteDataOnQuit, siteDataClearPending } from './site-data';
import { attachShortcuts } from './shortcuts';
import { disposeEphemeralSpaces, getActiveSpaceId, getSpace, initSpaces, onSessionCreated } from './spaces';
import { initPrivacyReport, registerPrivacySource } from './privacy-report';
import { createStore, flushAllStores, type JsonStore } from './store';
import { initSync, stopSync } from './sync/loader';
import {
  activateSpace,
  createTab,
  getActiveTab,
  getBrowserState,
  getTabSpaceId,
  initTabs,
  listSleepCandidates,
  noteBlocked,
  onStateChanged,
  onTabWebContents,
  restoreSession,
  serializeSession,
  sleepTab,
  freezeTab,
  tabIdForWebContents,
  type SavedTab,
} from './tabs';
import { initUpdater, stopUpdater } from './updater';
import { listenForOpenRequests, startOpening, urlsFromArgv } from './open-files';
import { applyWindowMaterial, createMainWindow, getChromeView, getMainWindow, refreshWindowTheme, saveBounds, sendToChrome } from './window';

/** VELA_STARTUP_TRACE=1 prints process-uptime marks for startup profiling (scripts measure these). */
const traceStartup = process.env.VELA_STARTUP_TRACE === '1';
function startupMark(name: string): void {
  if (traceStartup) console.info(`[tarnel:startup] ${name} ${Math.round(process.uptime() * 1000)}ms`);
}

// userData (TARNEL_USER_DATA / VELA_USER_DATA, Vela → Tarnel profile move) is settled in boot.ts.

const hasCdmRuntime = configureDrmStartup();
applyChromiumFlags(hasCdmRuntime);
startupMark('main-evaluated');

// @ghostery/adblocker-electron fires cosmetic scriptlets with an un-awaited executeJavaScript();
// a scriptlet throwing on a page surfaces here as an unhandled rejection. It is harmless page-level
// noise, so it is swallowed — anything else is still reported.
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error && reason.message.startsWith('Script failed to execute')) return;
  console.error('[tarnel] unhandled rejection', reason);
});
protocol.registerSchemesAsPrivileged([
  { scheme: DRM_PROBE_SCHEME, privileges: { standard: true, secure: true } },
  // codeCache: V8 code cache for tarnel:// pages (Chromium only caches http(s) by default); needs standard.
  { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  // Pre-rename alias: only redirects to tarnel:// (protocol.ts), registered alike so old URLs parse the same.
  { scheme: LEGACY_INTERNAL_SCHEME, privileges: { standard: true, secure: true } },
]);

let sessionStore: JsonStore<SavedTab[]> | null = null;
let quitState: 'running' | 'disposing' | 'done' = 'running';
let booted = false;
const DISPOSE_TIMEOUT_MS = 2000;
const SITE_CLEAR_EXTRA_MS = 3000;

function saveSession(): void {
  if (!booted || !sessionStore) return;
  sessionStore.set(serializeSession());
}

function openWindow(): BaseWindow {
  const win = createMainWindow();
  const chromeWc = getChromeView()?.webContents;
  if (chromeWc) {
    attachShortcuts(chromeWc);
    chromeWc.once('did-finish-load', () => startupMark('chrome-loaded'));
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
  listenForOpenRequests();
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (!booted) return;
    if (!getMainWindow()) openWindow();
    for (const url of urlsFromArgv(argv, workingDirectory)) createTab({ url, active: true });
    focusWindow();
  });

  app.on('web-contents-created', (_event, wc) => {
    wc.on('will-attach-webview', (event) => event.preventDefault());
  });

  void app.whenReady().then(() => {
    startupMark('ready');
    initDrm();
    applyGlobalUserAgent();
    initSecureDns();
    setPermissionPrompter(chromePermissionPrompter);
    electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    initSpaces();
    initIdentity();
    initFingerprint();
    initUserAgent();
    initSiteRules();
    initAudioDevices();
    initAudioMixer();
    initPasswords();
    initCookieBanners();

    initPrivacyReport({
      spaceOfWebContents: (wcId) => {
        const tabId = tabIdForWebContents(wcId);
        const space = tabId === null ? undefined : getSpace(getTabSpaceId(tabId) ?? '');
        return space ? { spaceId: space.id, ephemeral: space.ephemeral } : null;
      },
      openReport: () => createTab({ url: 'tarnel://privacy', active: true }),
    });
    registerPrivacySource('cookieBannersHandled', () => getCookieBannerStats().total);
    initAdblockEarly();
    void initAdblock().catch(() => undefined);
    initSafety();
    initFrameRate();
    onSessionCreated((ses) => {
      registerInternalProtocol(ses);
      attachDownloads(ses);
      trackDownloadsForSleep(ses);
      attachSafety(ses);
      enableAdblockForSession(ses);
    });
    initExtensions();
    onBlocked((wcId) => noteBlocked(wcId));
    onTrackingStripped((wcId, count) => {
      for (let i = 0; i < count; i += 1) noteBlocked(wcId);
    });

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
      for (const wc of webContents.getAllWebContents()) {
        if (!wc.isDestroyed() && isSettingsPage(wc.getURL())) wc.send(IPC.chromeEvents.settings, settings);
      }
      if (settings.windowMaterial !== material) {
        material = settings.windowMaterial;
        applyWindowMaterial(material);
      }
    });
    initPageTheme(refreshWindowTheme);
    registerIpc();

    openWindow();

    sessionStore = createStore<SavedTab[]>('session', []);
    if (getSettings().restoreSession) restoreSession(sessionStore.get());
    else activateSpace(getActiveSpaceId());
    for (const url of urlsFromArgv(process.argv)) createTab({ url, active: true });
    booted = true;
    startOpening((url) => {
      if (!getMainWindow()) openWindow();
      createTab({ url, active: true });
      focusWindow();
    });
    startupMark('booted');

    initBatterySaver();
    initSleeper({
      listTabs: listSleepCandidates,
      sleepTab,
      getSleepAfterMinutes: () => getSettings().sleepAfterMinutes,
      freezeTab,
      getFreezeAfterMinutes: () => getSettings().freezeAfterMinutes,
      getMemorySaver: () => ({ mode: getSettings().memorySaver, thresholdGB: getSettings().memorySaverThresholdGB }),
      tabIdForWebContents,
      onTick: () => runAutoArchive(),
    });
    initSync();
    initUpdater({
      beforeInstall: () => {
        saveSession();
        saveBounds();
        flushAllStores();
      },
    });
    // Persist the main-process compile cache (enabled in boot.ts) once startup modules have loaded,
    // rather than relying on a clean exit to write it.
    setTimeout(() => flushCompileCache?.(), 3000).unref();
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
    stopSync();
    stopUpdater();
    // Persist everything first so a slow/failed disposal can never lose state.
    try {
      saveSession();
      saveBounds();
      flushAllStores();
    } catch {
      /* still proceed with quitting */
    }
    // Clearing site data on close (Settings → Privacy) gets extra time; it is bounded all the same.
    const clearing = booted && siteDataClearPending();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, DISPOSE_TIMEOUT_MS + (clearing ? SITE_CLEAR_EXTRA_MS : 0)));
    const work = Promise.all([
      disposeEphemeralSpaces().catch(() => undefined),
      clearing ? clearSiteDataOnQuit().catch(() => undefined) : undefined,
    ]);
    void Promise.race([work, timeout]).finally(() => {
      quitState = 'done';
      app.quit();
    });
  });
}
