import { contextBridge, ipcRenderer } from 'electron';
import type { TabAudioSettings } from '../shared/audio-mixer';
import { MIXER_ENGINE_CHANNEL } from '../shared/audio-mixer-engine';
import { mixTabAudio } from './audio-mixer-main-world';

/**
 * Session-level preload, registered only on Spaces that have a tab with non-neutral mixer settings.
 * Runs in every frame before page scripts; frames of other tabs get null and stop here.
 */
function readSettings(): TabAudioSettings | null {
  try {
    return ipcRenderer.sendSync(MIXER_ENGINE_CHANNEL) as TabAudioSettings | null;
  } catch {
    return null;
  }
}

const settings = readSettings();
if (settings) {
  try {
    contextBridge.executeInMainWorld({ func: mixTabAudio, args: [settings] });
  } catch {
    /* never break the page */
  }
}
