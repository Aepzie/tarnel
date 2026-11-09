import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type VelaPagesAPI } from '../shared/ipc';

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
    listSpaces: () => call(ch.listSpaces),
    createSpace: (input) => call(ch.createSpace, input),
    updateSpace: (id, patch) => call(ch.updateSpace, id, patch),
    removeSpace: (id) => call(ch.removeSpace, id),
    clearSpaceData: (id) => call(ch.clearSpaceData, id),
    clearHistory: () => call(ch.clearHistory),
    navigate: (input) => call(ch.navigate, input),
    version: () => call(ch.version),
    currentSpace: () => call(ch.currentSpace),
    history: (query, limit, before) => call(ch.history, query, limit, before),
    deleteHistory: (url) => call(ch.historyDelete, url),
  };

  contextBridge.exposeInMainWorld('velaPages', api);
  applyBootTheme();
}

interface BootTheme {
  theme: 'dark' | 'light';
  accent: string | null;
  hero?: string;
}

/** Applies theme + accent synchronously before first paint so vela:// pages never flash. */
function applyBootTheme(): void {
  let boot: BootTheme | null = null;
  try {
    boot = ipcRenderer.sendSync('pages:boot-sync') as BootTheme | null;
  } catch {
    return;
  }
  if (!boot) return;
  const { theme, accent, hero } = boot;

  const apply = (root: HTMLElement): void => {
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme !== 'light');
    root.dataset.theme = theme;
    if (typeof hero === 'string' && /^[a-z-]{1,24}$/.test(hero)) root.dataset.hero = hero;
    if (accent && /^#[0-9a-f]{3,8}$/i.test(accent)) root.style.setProperty('--accent-space', accent);
  };

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
