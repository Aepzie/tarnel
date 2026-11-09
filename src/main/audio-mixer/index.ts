import { ipcMain, type Session, type WebContents, type WebFrameMain } from 'electron';
import { join } from 'node:path';
import { DEFAULT_TAB_AUDIO, isNeutralAudio, MIXER_IPC, type MixerRouting, type MixerTabState, type TabAudioLevel, type TabAudioSettings } from '../../shared/audio-mixer';
import { MIXER_ENGINE_CHANNEL, type RealmAudioReport } from '../../shared/audio-mixer-engine';
import type { SpaceId } from '../../shared/types';
import { mixTabAudio, reportTabAudio, touchTabAudio, updateTabAudio } from '../../preload/audio-mixer-main-world';
import { onTabMediaChanged } from '../audio-devices/state';
import { getSpace, getSpaceSession, onSessionRemoved } from '../spaces';
import { getTabSpaceId, getTabWebContents, listTabAudibility, onStateChanged, onTabWebContents, tabIdForWebContents } from '../tabs';
import { getChromeView, sendToChrome } from '../window';
import { applyAudioPatch, audioTabIds, onTabAudioChanged, setTabAudio, settingsOf, tabAudioSettings } from './state';

const PRELOAD = join(__dirname, '..', 'preload', 'audio-mixer.js');
const PRELOAD_ID = 'vela-audio-mixer';
const ENGINE_SOURCE = mixTabAudio.toString();
const UPDATE_SOURCE = updateTabAudio.toString();
const REPORT_SOURCE = reportTabAudio.toString();
const TOUCH_SOURCE = touchTabAudio.toString();

const LEVELS_INTERVAL_MS = 50;
const PUSH_DELAY_MS = 16;
const ROUTING_DELAY_MS = 250;
const SPECTRUM_BINS = 16;

/** Spaces whose session carries the preload: exactly those with a tab that needs processing. */
const registered = new Map<SpaceId, { session: Session; id: string }>();
/** Frames (per tab) that run an engine, keyed `processId:routingId`. */
const engineFrames = new Map<number, Map<string, WebFrameMain>>();
/** Frames where installing found nothing to hook (no Web Audio), by URL, so pushes don't retry them. */
const barren = new Map<string, string>();
const routings = new Map<number, MixerRouting>();
const pendingPushes = new Set<number>();
const routingTimers = new Map<number, NodeJS.Timeout>();
let pushTimer: NodeJS.Timeout | null = null;
let levelsTimer: NodeJS.Timeout | null = null;
let polling = false;
let sentLevels = false;
let lastState = '';
let chromeHooked: WebContents | null = null;

function payloadFor(tabId: number): TabAudioSettings | null {
  const settings = tabAudioSettings(tabId);
  return settings && !isNeutralAudio(settings) ? settings : null;
}

function frameKey(frame: WebFrameMain): string {
  return `${frame.processId}:${frame.routingId}`;
}

function alive(frame: WebFrameMain): boolean {
  try {
    return !frame.detached;
  } catch {
    return false;
  }
}

/** Runs a self-contained main-world function in one frame; undefined when the frame is gone. */
async function run(frame: WebFrameMain, source: string, arg: unknown): Promise<unknown> {
  if (!alive(frame)) return undefined;
  try {
    return await frame.executeJavaScript(`(${source})(${JSON.stringify(arg)})`);
  } catch {
    return undefined;
  }
}

function addEngineFrame(tabId: number, frame: WebFrameMain): void {
  let frames = engineFrames.get(tabId);
  if (!frames) engineFrames.set(tabId, (frames = new Map()));
  frames.set(frameKey(frame), frame);
}

function framesWithEngine(tabId: number): WebFrameMain[] {
  const frames = engineFrames.get(tabId);
  if (!frames) return [];
  for (const [key, frame] of frames) if (!alive(frame)) frames.delete(key);
  if (frames.size === 0) engineFrames.delete(tabId);
  return [...frames.values()];
}

function dropEngineFrame(tabId: number, frame: WebFrameMain): void {
  const frames = engineFrames.get(tabId);
  frames?.delete(frameKey(frame));
  if (frames?.size === 0) engineFrames.delete(tabId);
}

// ---- preload registration -------------------------------------------------

function syncPreloads(): void {
  const wanted = new Set<SpaceId>();
  for (const tabId of audioTabIds()) {
    const spaceId = getTabSpaceId(tabId);
    if (spaceId && getSpace(spaceId) && payloadFor(tabId)) wanted.add(spaceId);
  }
  for (const [spaceId, entry] of registered) {
    if (wanted.has(spaceId)) continue;
    registered.delete(spaceId);
    try {
      entry.session.unregisterPreloadScript(entry.id);
    } catch {
      /* session gone */
    }
  }
  for (const spaceId of wanted) {
    if (registered.has(spaceId)) continue;
    const session = getSpaceSession(spaceId);
    const id = session.registerPreloadScript({ id: `${PRELOAD_ID}-${spaceId}`, type: 'frame', filePath: PRELOAD });
    registered.set(spaceId, { session, id });
  }
}

// ---- live settings --------------------------------------------------------

/** Documents loaded before the tab needed processing never ran the preload: install in place. */
async function pushSettings(tabId: number): Promise<void> {
  const wc = getTabWebContents(tabId);
  if (!wc || wc.isDestroyed()) return;
  const payload = payloadFor(tabId);
  let frames: WebFrameMain[];
  try {
    frames = wc.mainFrame.framesInSubtree;
  } catch {
    return;
  }
  await Promise.all(
    frames.map(async (frame) => {
      if ((await run(frame, UPDATE_SOURCE, payload)) === true) return addEngineFrame(tabId, frame);
      dropEngineFrame(tabId, frame);
      if (!payload || !alive(frame)) return;
      const key = frameKey(frame);
      if (barren.get(key) === frame.url) return;
      if ((await run(frame, ENGINE_SOURCE, payload)) === true) {
        barren.delete(key);
        addEngineFrame(tabId, frame);
      } else if (alive(frame)) {
        if (barren.size > 512) barren.clear();
        barren.set(key, frame.url);
      }
    }),
  );
  scheduleRouting(tabId);
}

function flushPushes(): void {
  pushTimer = null;
  const tabIds = [...pendingPushes];
  pendingPushes.clear();
  for (const tabId of tabIds) void pushSettings(tabId);
}

/** Coalesces slider drags to one push per frame. */
function schedulePush(tabId: number): void {
  pendingPushes.add(tabId);
  pushTimer ??= setTimeout(flushPushes, PUSH_DELAY_MS);
}

// ---- routing & state --------------------------------------------------------

function validRouting(value: unknown): MixerRouting | null {
  return value === 'full' || value === 'partial' || value === 'idle' ? value : null;
}

function strongest(routings: MixerRouting[]): MixerRouting {
  if (routings.includes('partial')) return 'partial';
  if (routings.includes('full')) return 'full';
  return 'idle';
}

/** Asks every engine frame of a tab; frames without an engine (navigated away) are dropped. */
async function reportsOf(tabId: number, levels: boolean): Promise<RealmAudioReport[]> {
  const frames = framesWithEngine(tabId);
  const reports = await Promise.all(frames.map((frame) => run(frame, REPORT_SOURCE, levels)));
  const valid: RealmAudioReport[] = [];
  reports.forEach((report, i) => {
    const routing = report && typeof report === 'object' ? validRouting((report as RealmAudioReport).routing) : null;
    if (!routing) return dropEngineFrame(tabId, frames[i]!);
    valid.push({ ...(report as RealmAudioReport), routing });
  });
  return valid;
}

function setRouting(tabId: number, routing: MixerRouting): void {
  if (getTabSpaceId(tabId) === null) return;
  if ((routings.get(tabId) ?? 'idle') === routing) return;
  if (routing === 'idle') routings.delete(tabId);
  else routings.set(tabId, routing);
  emitState();
}

async function refreshRouting(tabId: number): Promise<void> {
  const reports = await reportsOf(tabId, false);
  setRouting(tabId, strongest(reports.map((report) => report.routing)));
}

function scheduleRouting(tabId: number): void {
  clearTimeout(routingTimers.get(tabId));
  routingTimers.set(
    tabId,
    setTimeout(() => {
      routingTimers.delete(tabId);
      void refreshRouting(tabId);
    }, ROUTING_DELAY_MS),
  );
}

function stateOf(tabId: number): MixerTabState {
  return { tabId, settings: settingsOf(tabId), routing: routings.get(tabId) ?? 'idle' };
}

/** Tabs that are audible or have settings, in tab order. */
function mixerStates(): MixerTabState[] {
  return listTabAudibility()
    .filter((tab) => tab.audible || tabAudioSettings(tab.id))
    .map((tab) => stateOf(tab.id));
}

function emitState(): void {
  const states = mixerStates();
  const json = JSON.stringify(states);
  if (json === lastState) return;
  lastState = json;
  sendToChrome(MIXER_IPC.stateEvent, states);
}

// ---- levels -------------------------------------------------------------------

function unit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

async function levelOf(tabId: number): Promise<TabAudioLevel> {
  const reports = await reportsOf(tabId, true);
  let peakL = 0;
  let peakR = 0;
  let spectrum: number[] = [];
  for (const report of reports) {
    peakL = Math.max(peakL, unit(report.peakL));
    peakR = Math.max(peakR, unit(report.peakR));
    if (!Array.isArray(report.spectrum) || report.spectrum.length !== SPECTRUM_BINS) continue;
    const bins = report.spectrum.map(unit);
    spectrum = spectrum.length === 0 ? bins : spectrum.map((value, i) => Math.max(value, bins[i]!));
  }
  if (reports.length > 0) setRouting(tabId, strongest(reports.map((report) => report.routing)));
  return { tabId, peakL, peakR, spectrum };
}

/** One sample per audible tab; tabs without an engine report silence and no spectrum. */
async function pollLevels(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const audible = listTabAudibility().filter((tab) => tab.audible);
    const levels = await Promise.all(
      audible.map((tab) => (engineFrames.has(tab.id) ? levelOf(tab.id) : { tabId: tab.id, peakL: 0, peakR: 0, spectrum: [] })),
    );
    if (levels.length === 0 && !sentLevels) return;
    sentLevels = levels.length > 0;
    if (levelsTimer) sendToChrome(MIXER_IPC.levelsEvent, levels);
  } finally {
    polling = false;
  }
}

function watchLevels(on: boolean): void {
  if (!on) {
    if (levelsTimer) clearInterval(levelsTimer);
    levelsTimer = null;
    return;
  }
  if (levelsTimer) return;
  levelsTimer = setInterval(() => void pollLevels(), LEVELS_INTERVAL_MS);
  // A reloaded or crashed chrome cannot say stop.
  const chrome = getChromeView()?.webContents;
  if (chrome && chromeHooked !== chrome) {
    chromeHooked = chrome;
    const stop = (): void => watchLevels(false);
    chrome.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) stop();
    });
    chrome.on('render-process-gone', stop);
    chrome.once('destroyed', stop);
  }
}

// ---- IPC ----------------------------------------------------------------------

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

function tabId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || getTabSpaceId(value) === null) throw new TypeError('Unknown tab');
  return value;
}

/** Mixer handlers; `handle` is ipc.ts's chrome-only (sender-checked) registrar. */
export function registerMixerIpc(handle: ChromeHandler): void {
  handle(MIXER_IPC.get, () => mixerStates());
  handle(MIXER_IPC.set, (id, patch) => {
    const tab = tabId(id);
    setTabAudio(tab, applyAudioPatch(settingsOf(tab), patch));
    return stateOf(tab);
  });
  handle(MIXER_IPC.reset, (id) => {
    const tab = tabId(id);
    setTabAudio(tab, DEFAULT_TAB_AUDIO);
    return stateOf(tab);
  });
  handle(MIXER_IPC.watchLevels, (on) => {
    if (typeof on !== 'boolean') throw new TypeError('Invalid boolean');
    watchLevels(on);
  });
}

// ---- wiring -------------------------------------------------------------------

function watchTab(wc: WebContents, id: number): void {
  const changed = (): void => {
    if (engineFrames.has(id)) scheduleRouting(id);
  };
  wc.on('media-started-playing', changed);
  wc.on('media-paused', changed);
  wc.on('audio-state-changed', changed);
  wc.once('destroyed', () => {
    engineFrames.delete(id);
    if (getTabSpaceId(id) !== null) setRouting(id, 'idle');
  });
}

export function initAudioMixer(): void {
  ipcMain.on(MIXER_ENGINE_CHANNEL, (event) => {
    try {
      const id = tabIdForWebContents(event.sender.id);
      const payload = id === null ? null : payloadFor(id);
      if (payload && id !== null && event.senderFrame) {
        addEngineFrame(id, event.senderFrame);
        scheduleRouting(id);
      }
      event.returnValue = payload;
    } catch {
      event.returnValue = null;
    }
  });
  onTabWebContents(watchTab);
  onSessionRemoved((session) => {
    for (const [spaceId, entry] of registered) if (entry.session === session) registered.delete(spaceId);
  });
  onStateChanged(() => {
    // A processed tab may move to another Space (another session).
    if (registered.size > 0 || audioTabIds().length > 0) syncPreloads();
    emitState();
  });
  onTabAudioChanged((id) => {
    syncPreloads();
    if (getTabSpaceId(id) === null) {
      engineFrames.delete(id);
      routings.delete(id);
    } else {
      schedulePush(id);
    }
    emitState();
  });
  // A live audio-devices route only steers contexts it sees: show it the processing context.
  onTabMediaChanged((id, change) => {
    if (change !== 'devices') return;
    setTimeout(() => {
      for (const frame of framesWithEngine(id)) void run(frame, TOUCH_SOURCE, null);
    }, 100);
  });
}
