import { contextBridge, ipcRenderer } from 'electron';
import { MEDIA_ROUTE_CHANNEL, type MediaRoute } from '../shared/audio-devices';
import { routeMediaDevices } from './audio-devices-main-world';

/**
 * Session-level preload, registered only on Spaces that have a tab with a picked device. Runs in
 * every frame before page scripts; frames of tabs on "System default" get null and stop here.
 */
function readRoute(): MediaRoute | null {
  try {
    return ipcRenderer.sendSync(MEDIA_ROUTE_CHANNEL) as MediaRoute | null;
  } catch {
    return null;
  }
}

const route = readRoute();
if (route) {
  try {
    contextBridge.executeInMainWorld({ func: routeMediaDevices, args: [route] });
  } catch {
    /* never break the page */
  }
}
