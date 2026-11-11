import { randomUUID } from 'node:crypto';
import {
  clampPanelWidth,
  normalizePanelUrl,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_COUNT,
  PANEL_NAME_MAX,
  panelNameFor,
  type PanelInput,
  type PanelPatch,
  type WebPanel,
} from '../../shared/panels';
import { createStore, type JsonStore } from '../store';

/** Persisted panel list (`panels.json`). Only read when the first panel feature call happens. */

const ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const MAX_FAVICON = 96 * 1024;

let store: JsonStore<WebPanel[]> | null = null;

function cleanName(raw: unknown, url: string): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, PANEL_NAME_MAX) : '';
  return name || panelNameFor(url);
}

function repair(raw: unknown): WebPanel | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const url = typeof entry.url === 'string' ? normalizePanelUrl(entry.url) : null;
  if (!url || typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) return null;
  const favicon = typeof entry.favicon === 'string' && entry.favicon.startsWith('data:image/') && entry.favicon.length <= MAX_FAVICON ? entry.favicon : null;
  return {
    id: entry.id,
    name: cleanName(entry.name, url),
    url,
    width: clampPanelWidth(typeof entry.width === 'number' ? entry.width : PANEL_DEFAULT_WIDTH),
    mobile: entry.mobile === true,
    muted: entry.muted === true,
    favicon,
  };
}

function getStore(): JsonStore<WebPanel[]> {
  if (!store) {
    store = createStore<WebPanel[]>('panels', []);
    const current = store.get();
    const repaired = (Array.isArray(current) ? current : []).map(repair).filter((panel): panel is WebPanel => panel !== null).slice(0, PANEL_MAX_COUNT);
    if (JSON.stringify(repaired) !== JSON.stringify(current)) store.set(repaired);
  }
  return store;
}

export function listPanels(): WebPanel[] {
  return getStore().get();
}

export function getPanel(id: string): WebPanel | undefined {
  return listPanels().find((panel) => panel.id === id);
}

export function isPanelId(raw: unknown): raw is string {
  return typeof raw === 'string' && ID_PATTERN.test(raw) && getPanel(raw) !== undefined;
}

/** Validates renderer input; throws on anything unusable. */
export function addPanel(input: unknown): WebPanel {
  if (!input || typeof input !== 'object') throw new TypeError('Invalid panel');
  const raw = input as Partial<Record<keyof PanelInput, unknown>>;
  const url = typeof raw.url === 'string' ? normalizePanelUrl(raw.url) : null;
  if (!url) throw new TypeError('Invalid panel URL');
  if (listPanels().length >= PANEL_MAX_COUNT) throw new Error('Too many panels');
  const panel: WebPanel = {
    id: randomUUID(),
    name: cleanName(raw.name, url),
    url,
    width: PANEL_DEFAULT_WIDTH,
    mobile: raw.mobile === true,
    muted: false,
    favicon: null,
  };
  getStore().update((panels) => [...panels, panel]);
  return panel;
}

export function patchFromInput(raw: unknown): PanelPatch {
  if (!raw || typeof raw !== 'object') throw new TypeError('Invalid patch');
  const entry = raw as Record<string, unknown>;
  const patch: PanelPatch = {};
  if (entry.url !== undefined) {
    const url = typeof entry.url === 'string' ? normalizePanelUrl(entry.url) : null;
    if (!url) throw new TypeError('Invalid panel URL');
    patch.url = url;
  }
  if (entry.name !== undefined) {
    if (typeof entry.name !== 'string') throw new TypeError('Invalid name');
    patch.name = entry.name;
  }
  if (entry.width !== undefined) {
    if (typeof entry.width !== 'number') throw new TypeError('Invalid width');
    patch.width = clampPanelWidth(entry.width);
  }
  if (entry.mobile !== undefined) {
    if (typeof entry.mobile !== 'boolean') throw new TypeError('Invalid mobile flag');
    patch.mobile = entry.mobile;
  }
  return patch;
}

/** Applies a validated patch (plus internal fields) and returns the updated panel. */
export function updatePanel(id: string, patch: PanelPatch & Partial<Pick<WebPanel, 'muted' | 'favicon'>>): WebPanel | undefined {
  getStore().update((panels) =>
    panels.map((panel) => {
      if (panel.id !== id) return panel;
      const url = patch.url ?? panel.url;
      return {
        ...panel,
        ...patch,
        url,
        name: patch.name === undefined ? panel.name : cleanName(patch.name, url),
        favicon: patch.url && patch.url !== panel.url && patch.favicon === undefined ? null : (patch.favicon ?? panel.favicon),
      };
    }),
  );
  return getPanel(id);
}

export function removePanel(id: string): void {
  getStore().update((panels) => panels.filter((panel) => panel.id !== id));
}

export function partitionFor(id: string): string {
  return `persist:panel-${id}`;
}
