import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EXTENSION_IPC, IPC, SAFETY_IPC, type VelaPagesAPI } from '../shared/ipc';
import { IMPORT_IPC } from '../shared/import';
import { SITE_IPC } from '../shared/site-data';
import { BOOKMARKS_IPC } from '../shared/bookmarks-ipc';
import { PASSWORD_IPC } from '../shared/passwords';
import { TRANSLATE_IPC } from '../shared/translate';
import { SITE_RULES_IPC } from '../shared/site-rules';
import { ALIAS_IPC } from '../shared/aliases';
import { PRIVACY_REPORT_IPC } from '../shared/privacy-report';
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
      confirmInstall: (token) => call(EXTENSION_IPC.confirmInstall, token),
      cancelInstall: (token) => call(EXTENSION_IPC.cancelInstall, token),
    },
    safety: {
      status: () => call(SAFETY_IPC.status),
      proceed: (url) => call(SAFETY_IPC.proceed, url),
    },
    bookmarks: {
      list: (spaceId) => call(BOOKMARKS_IPC.pagesList, spaceId ?? null),
      add: (input, spaceId) => call(BOOKMARKS_IPC.pagesAdd, input, spaceId ?? null),
      update: (id, patch, spaceId) => call(BOOKMARKS_IPC.pagesUpdate, id, patch, spaceId ?? null),
      remove: (id, spaceId) => call(BOOKMARKS_IPC.pagesRemove, id, spaceId ?? null),
      search: (query, limit, spaceId) => call(BOOKMARKS_IPC.pagesSearch, query, limit ?? null, spaceId ?? null),
    },
    translate: {
      overview: () => call(TRANSLATE_IPC.overview),
      setPrefs: (patch) => call(TRANSLATE_IPC.setPrefs, patch),
      deleteModel: (pair) => call(TRANSLATE_IPC.deleteModel, pair),
      refreshCatalog: () => call(TRANSLATE_IPC.refreshCatalog),
    },
    siteRules: {
      list: () => call(SITE_RULES_IPC.list),
      save: (rules) => call(SITE_RULES_IPC.save, rules),
      test: (url) => call(SITE_RULES_IPC.test, url),
      draft: () => call(SITE_RULES_IPC.draft),
      context: () => call(SITE_RULES_IPC.context),
    },
    siteData: {
      list: () => call(SITE_IPC.pagesPolicies),
      set: (spaceId, policy) => call(SITE_IPC.pagesSetPolicy, spaceId, policy),
    },
    browserImport: {
      profiles: () => call(IMPORT_IPC.profiles),
      run: (profileId, kind, spaceId) => call(IMPORT_IPC.run, profileId, kind, spaceId),
      pickPasswordCsv: () => call(IMPORT_IPC.pickPasswordCsv),
      importPasswords: (token, spaceId) => call(IMPORT_IPC.importPasswords, token, spaceId),
      discardPasswords: (token) => call(IMPORT_IPC.discardPasswords, token),
      hint: () => call(IMPORT_IPC.hint),
      dismissHint: () => call(IMPORT_IPC.dismissHint),
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
    privacyReport: {
      get: () => call(PRIVACY_REPORT_IPC.get),
      reset: () => call(PRIVACY_REPORT_IPC.reset),
    },
  };

  if (location.host === 'passwords') {
    const pw = PASSWORD_IPC;
    api.passwords = {
      status: () => call(pw.status),
      list: (spaceId) => call(pw.list, spaceId),
      reveal: (spaceId, loginId) => call(pw.reveal, spaceId, loginId),
      copy: (spaceId, loginId, field) => call(pw.copy, spaceId, loginId, field),
      update: (spaceId, loginId, patch) => call(pw.update, spaceId, loginId, patch),
      remove: (spaceId, loginId) => call(pw.remove, spaceId, loginId),
      exportCsv: (spaceId) => call(pw.exportCsv, spaceId),
      removeNever: (spaceId, origin) => call(pw.neverRemove, spaceId, origin),
    };
  }

  if (location.host === 'settings') {
    api.aliases = {
      get: () => call(ALIAS_IPC.get),
      set: (patch) => call(ALIAS_IPC.set, patch),
      setKey: (key) => call(ALIAS_IPC.setKey, key),
      options: () => call(ALIAS_IPC.options),
    };
  }

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
