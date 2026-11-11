import { app, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  DEFAULT_TRANSLATE_PREFS,
  TRANSLATE_IPC,
  knownLanguages,
  languageName,
  normalizeLang,
  type TranslateOverview,
  type TranslatePrefs,
  type TranslateTabState,
} from '../../shared/translate';
import { createStore, type JsonStore } from '../store';
import { getTabWebContents, onTabWebContents } from '../tabs';
import { sendToChrome } from '../window';
import { pairKey, route, type ModelSet } from './catalog';
import { detectLanguage } from './detect';
import { ensureModel, translateTexts, unloadModel } from './engine-host';
import { cachedSets, deleteInstalled, ensureDownloaded, getCatalog, listInstalled, modelPaths } from './models';
import { TRANSLATE_WORLD_ID, pageCode, type PageCommand, type PageProbe } from './page-script';

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

/** Characters per engine call: big enough for throughput, small enough for visible progress. */
const BATCH_CHARS = 2500;
const LANG_CODE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

let prefsStore: JsonStore<TranslatePrefs> | null = null;
const tabStates = new Map<number, TranslateTabState>();
const generations = new Map<number, number>();

function prefs(): JsonStore<TranslatePrefs> {
  prefsStore ??= createStore<TranslatePrefs>('translate', { ...DEFAULT_TRANSLATE_PREFS, targetLang: normalizeLang(app.getLocale()) ?? 'en' });
  return prefsStore;
}

function sanitizePrefs(raw: unknown): Partial<TranslatePrefs> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Invalid prefs');
  const input = raw as Record<string, unknown>;
  const patch: Partial<TranslatePrefs> = {};
  if (input.targetLang !== undefined) {
    if (typeof input.targetLang !== 'string' || !knownLanguages().includes(input.targetLang)) throw new TypeError('Invalid language');
    patch.targetLang = input.targetLang;
  }
  if (input.alwaysTranslate !== undefined) {
    if (!Array.isArray(input.alwaysTranslate) || input.alwaysTranslate.length > 100) throw new TypeError('Invalid list');
    patch.alwaysTranslate = [...new Set(input.alwaysTranslate.filter((code): code is string => typeof code === 'string' && LANG_CODE.test(code)))];
  }
  if (input.offer !== undefined) {
    if (typeof input.offer !== 'boolean') throw new TypeError('Invalid boolean');
    patch.offer = input.offer;
  }
  return patch;
}

function blankState(tabId: number): TranslateTabState {
  return { tabId, pageLang: null, targetLang: prefs().get().targetLang, available: false, phase: 'idle', progress: 0, shownLang: null, error: null };
}

function setState(tabId: number, patch: Partial<TranslateTabState>): TranslateTabState {
  const next = { ...(tabStates.get(tabId) ?? blankState(tabId)), ...patch };
  tabStates.set(tabId, next);
  sendToChrome(TRANSLATE_IPC.tabChanged, next);
  return next;
}

async function runInPage<T>(wc: WebContents, command: PageCommand): Promise<T> {
  return (await wc.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code: pageCode(command) }])) as T;
}

function isWebPage(wc: WebContents): boolean {
  return /^https?:|^file:/.test(wc.getURL());
}

/** Page language: the detector wins when it is confident (many sites ship a wrong `lang`). */
async function probe(wc: WebContents): Promise<{ lang: string | null; translated: boolean }> {
  const page = await runInPage<PageProbe>(wc, { op: 'probe' });
  return { lang: detectLanguage(page.sample) ?? normalizeLang(page.lang), translated: page.translated };
}

async function availability(from: string | null, to: string): Promise<boolean> {
  if (!from || from === to) return false;
  try {
    return route(await getCatalog(), from, to).length > 0;
  } catch {
    return false;
  }
}

export async function getTabState(tabId: number): Promise<TranslateTabState> {
  const wc = getTabWebContents(tabId);
  const current = tabStates.get(tabId) ?? blankState(tabId);
  if (!wc || wc.isDestroyed() || !isWebPage(wc) || current.phase === 'downloading' || current.phase === 'translating') return current;
  const targetLang = prefs().get().targetLang;
  if (current.pageLang && current.targetLang === targetLang) return current;
  try {
    const page = await probe(wc);
    return setState(tabId, { pageLang: page.lang, targetLang, available: await availability(page.lang, targetLang) });
  } catch {
    return current;
  }
}

function batches(pairs: [number, string][]): [number, string][][] {
  const out: [number, string][][] = [];
  let current: [number, string][] = [];
  let size = 0;
  for (const pair of pairs) {
    if (current.length && size + pair[1].length > BATCH_CHARS) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(pair);
    size += pair[1].length;
  }
  if (current.length) out.push(current);
  return out;
}

async function prepareChain(tabId: number, chain: ModelSet[], stale: () => boolean): Promise<void> {
  const total = chain.length;
  for (const [index, set] of chain.entries()) {
    await ensureDownloaded(set, (fraction) => {
      if (!stale()) setState(tabId, { phase: 'downloading', progress: (index + fraction) / total });
    });
    await ensureModel(pairKey(set), modelPaths(set));
  }
}

/** Translates a tab's page in place. Resolves with the final state (errors are reported in it). */
export async function translateTab(tabId: number, toLang?: string): Promise<TranslateTabState> {
  const wc = getTabWebContents(tabId);
  if (!wc || wc.isDestroyed() || !isWebPage(wc)) return setState(tabId, { phase: 'error', error: 'This page cannot be translated' });
  const to = toLang ?? prefs().get().targetLang;
  const generation = (generations.get(tabId) ?? 0) + 1;
  generations.set(tabId, generation);
  const stale = (): boolean => generations.get(tabId) !== generation || wc.isDestroyed();
  try {
    const page = await probe(wc);
    const from = page.lang;
    if (!from) return setState(tabId, { phase: 'error', error: 'Could not detect the page language' });
    const previous = tabStates.get(tabId);
    if (previous?.shownLang === to && page.translated) return previous;
    const chain = route(await getCatalog(), from, to);
    if (!chain.length) return setState(tabId, { pageLang: from, targetLang: to, available: false, phase: 'error', error: `No ${languageName(from)} → ${languageName(to)} model available` });
    setState(tabId, { pageLang: from, targetLang: to, available: true, phase: 'downloading', progress: 0, error: null });
    await prepareChain(tabId, chain, stale);
    if (stale()) return tabStates.get(tabId) ?? blankState(tabId);
    if (previous?.shownLang === to && (await runInPage<number>(wc, { op: 'reapply' })) > 0) {
      return setState(tabId, { phase: 'translated', progress: 1, shownLang: to });
    }
    setState(tabId, { phase: 'translating', progress: 0 });
    const keys = chain.map(pairKey);
    for (let round = 0; round < 2; round++) {
      const pending = batches(await runInPage<[number, string][]>(wc, { op: 'collect' }));
      for (const [index, batch] of pending.entries()) {
        if (stale()) return tabStates.get(tabId) ?? blankState(tabId);
        const translated = await translateTexts(keys, batch.map(([, text]) => text));
        await runInPage<number>(wc, { op: 'apply', pairs: batch.map(([id], i) => [id, translated[i] ?? '']) });
        setState(tabId, { progress: (index + 1) / pending.length, shownLang: to });
      }
    }
    return setState(tabId, { phase: 'translated', progress: 1, shownLang: to });
  } catch (error) {
    if (stale()) return tabStates.get(tabId) ?? blankState(tabId);
    return setState(tabId, { phase: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

export async function showOriginal(tabId: number): Promise<TranslateTabState> {
  generations.set(tabId, (generations.get(tabId) ?? 0) + 1);
  const wc = getTabWebContents(tabId);
  if (wc && !wc.isDestroyed()) await runInPage<number>(wc, { op: 'restore' }).catch(() => 0);
  const state = tabStates.get(tabId);
  return setState(tabId, { phase: 'idle', progress: 0, shownLang: state?.pageLang ?? null, error: null });
}

function watchTab(wc: WebContents, tabId: number): void {
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    generations.set(tabId, (generations.get(tabId) ?? 0) + 1);
    if (tabStates.has(tabId)) setState(tabId, blankState(tabId));
  });
  wc.on('did-finish-load', () => {
    const always = prefs().get().alwaysTranslate;
    if (!always.length || !isWebPage(wc)) return;
    void probe(wc)
      .then((page) => {
        if (page.lang && always.includes(page.lang) && page.lang !== prefs().get().targetLang) return translateTab(tabId);
        return undefined;
      })
      .catch(() => undefined);
  });
  wc.once('destroyed', () => {
    tabStates.delete(tabId);
    generations.delete(tabId);
  });
}

async function overview(): Promise<TranslateOverview> {
  const sets = await cachedSets();
  const fromCatalog = new Set(sets.flatMap((set) => [set.from, set.to]));
  const codes = fromCatalog.size ? knownLanguages().filter((code) => fromCatalog.has(code)) : knownLanguages();
  return {
    prefs: prefs().get(),
    languages: codes.map((code) => ({ code, name: languageName(code) })).sort((a, b) => a.name.localeCompare(b.name)),
    pairs: sets.map(pairKey),
    installed: await listInstalled(),
  };
}

function optLang(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !LANG_CODE.test(value)) throw new TypeError('Invalid language');
  return value;
}

function tabIdArg(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Invalid tab id');
  return value;
}

export function registerTranslateIpc(handleChrome: ChromeHandler, handlePages: PagesHandler): void {
  onTabWebContents(watchTab);
  handleChrome(TRANSLATE_IPC.tabState, (tabId) => getTabState(tabIdArg(tabId)));
  handleChrome(TRANSLATE_IPC.translateTab, (tabId, to) => translateTab(tabIdArg(tabId), optLang(to)));
  handleChrome(TRANSLATE_IPC.showOriginal, (tabId) => showOriginal(tabIdArg(tabId)));
  handlePages(TRANSLATE_IPC.overview, () => overview());
  handlePages(TRANSLATE_IPC.setPrefs, (_event, patch) => {
    prefs().update((current) => ({ ...current, ...sanitizePrefs(patch) }));
    return overview();
  });
  handlePages(TRANSLATE_IPC.deleteModel, async (_event, pair) => {
    if (typeof pair !== 'string') throw new TypeError('Invalid model pair');
    await unloadModel(pair).catch(() => undefined);
    await deleteInstalled(pair);
    return overview();
  });
  handlePages(TRANSLATE_IPC.refreshCatalog, async () => {
    await getCatalog(true);
    return overview();
  });
}
