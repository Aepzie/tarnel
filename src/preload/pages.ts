import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EXTENSION_IPC, IPC, type VelaPagesAPI } from '../shared/ipc';
import type { UpdateStatus } from '../shared/types';

const isVelaPage = (): boolean => location.protocol === 'vela:';

if (isVelaPage()) {
  const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    isVelaPage()
      ? (ipcRenderer.invoke(channel, ...args) as Promise<T>)
      : Promise.reject(new Error('velaPages is only available on vela:// pages'));

  const ch = IPC.pages;
  const api: VelaPagesAPI = {
    getSettings: () => call(ch.getSettings),
    setSettings: (patch) => call(ch.setSettings, patch),
    topSites: () => call(ch.topSites),
    perf: () => call(ch.perf),
    frameRate: () => call(ch.frameRate),
    relaunch: () => call(ch.relaunch),
    listSpaces: () => call(ch.listSpaces),
    createSpace: (input) => call(ch.createSpace, input),
    updateSpace: (id, patch) => call(ch.updateSpace, id, patch),
    removeSpace: (id) => call(ch.removeSpace, id),
    clearSpaceData: (id) => call(ch.clearSpaceData, id),
    regenerateFingerprint: (id) => call(ch.regenerateFingerprint, id),
    clearHistory: () => call(ch.clearHistory),
    navigate: (input) => call(ch.navigate, input),
    version: () => call(ch.version),
    currentSpace: () => call(ch.currentSpace),
    history: (query, limit, before) => call(ch.history, query, limit, before),
    deleteHistory: (url) => call(ch.historyDelete, url),
    extensions: {
      list: () => call(EXTENSION_IPC.list),
      install: (input) => call(EXTENSION_IPC.install, input),
      loadUnpacked: () => call(EXTENSION_IPC.loadUnpacked),
      update: (id, patch) => call(EXTENSION_IPC.update, id, patch),
      reload: (id) => call(EXTENSION_IPC.reload, id),
      remove: (id) => call(EXTENSION_IPC.remove, id),
      openOptions: (id) => call(EXTENSION_IPC.pageOptions, id),
    },
    sync: {
      status: () => call(ch.syncStatus),
      pickFolder: () => call(ch.syncPickFolder),
      probe: (transport) => call(ch.syncProbe, transport),
      enable: (input) => call(ch.syncEnable, input),
      setCategories: (categories) => call(ch.syncSetCategories, categories),
      now: () => call(ch.syncNow),
      recoveryKey: () => call(ch.syncRecoveryKey),
      disconnect: (wipeRemote) => call(ch.syncDisconnect, wipeRemote),
    },
    updates: {
      get: () => call(ch.updateGet),
      onStatus: (cb) => {
        const listener = (_event: IpcRendererEvent, status: UpdateStatus): void => cb(status);
        ipcRenderer.on(IPC.pagesEvents.update, listener);
        void call(ch.updateWatch).catch(() => undefined);
        return () => {
          ipcRenderer.removeListener(IPC.pagesEvents.update, listener);
        };
      },
      check: () => call(ch.updateCheck),
      download: () => call(ch.updateDownload),
      install: () => call(ch.updateInstall),
      openRelease: () => call(ch.updateOpenRelease),
    },
  };

  contextBridge.exposeInMainWorld('velaPages', api);
  applyBootTheme();
}

interface BootTheme {
  theme: 'dark' | 'light';
  mode?: string;
  accent: string | null;
  hero?: string;
}

function applyPageTheme(root: HTMLElement, { theme, mode, accent, hero }: BootTheme): void {
  root.classList.toggle('light', theme === 'light');
  root.classList.toggle('dark', theme !== 'light');
  root.dataset.theme = theme;
  if (typeof mode === 'string' && /^[a-z]{1,8}$/.test(mode)) root.dataset.themeMode = mode;
  if (typeof hero === 'string' && /^[a-z-]{1,24}$/.test(hero)) root.dataset.hero = hero;
  if (accent && /^#[0-9a-f]{3,8}$/i.test(accent)) root.style.setProperty('--accent-space', accent);
}

/**
 * Applies theme + accent synchronously before first paint so vela:// pages never flash, then
 * follows live changes (theme setting, OS scheme, Space colour) pushed by the main process.
 */
function applyBootTheme(): void {
  ipcRenderer.on(IPC.pagesEvents.theme, (_event: IpcRendererEvent, next: BootTheme | null) => {
    if (next && document.documentElement) applyPageTheme(document.documentElement, next);
  });
  let boot: BootTheme | null = null;
  try {
    boot = ipcRenderer.sendSync('pages:boot-sync') as BootTheme | null;
  } catch {
    return;
  }
  if (!boot) return;
  const initial = boot;
  const apply = (root: HTMLElement): void => applyPageTheme(root, initial);

  if (document.documentElement) {
    apply(document.documentElement);
    return;
  }
  const observer = new MutationObserver(() => {
    if (!document.documentElement) return;
    observer.disconnect();
    apply(document.documentElement);
  });
  observer.observe(document, { childList: true });
  document.addEventListener('DOMContentLoaded', () => apply(document.documentElement), { once: true });
}
