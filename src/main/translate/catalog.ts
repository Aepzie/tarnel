/**
 * Mozilla's translation model catalog (Remote Settings collection `translations-models`), parsed into
 * one downloadable file set per language pair. Pure: no electron / network, unit-tested.
 *
 * Source of truth: https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records
 * Attachments: <attachments base_url> + attachment.location, verified against attachment.hash (SHA-256).
 */

export const CATALOG_URL = 'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records';
export const SERVER_URL = 'https://firefox.settings.services.mozilla.com/v1/';
export const DEFAULT_ATTACHMENT_BASE = 'https://firefox-settings-attachments.cdn.mozilla.net/';

export type ModelFileType = 'model' | 'lex' | 'vocab' | 'srcvocab' | 'trgvocab';

export interface ModelFile {
  fileType: ModelFileType;
  /** Original file name, e.g. model.ende.intgemm.alphas.bin */
  name: string;
  /** Path below the attachment base URL. */
  location: string;
  sha256: string;
  size: number;
}

export interface ModelSet {
  from: string;
  to: string;
  version: string;
  files: ModelFile[];
}

const FILE_TYPES: readonly ModelFileType[] = ['model', 'lex', 'vocab', 'srcvocab', 'trgvocab'];
const STABLE_VERSION = /^\d+(\.\d+){0,3}$/;
const HASH = /^[0-9a-f]{64}$/;
const LOCATION = /^[A-Za-z0-9/_.-]{1,256}$/;
const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function isComplete(files: ModelFile[]): boolean {
  const types = new Set(files.map((file) => file.fileType));
  if (!types.has('model') || !types.has('lex')) return false;
  return types.has('vocab') || (types.has('srcvocab') && types.has('trgvocab'));
}

/**
 * Picks, per language pair, the newest *stable* version that is complete and has no
 * filter_expression (those target specific Firefox channels/platforms only).
 */
export function parseCatalog(raw: unknown): ModelSet[] {
  const records = (raw as { data?: unknown })?.data;
  if (!Array.isArray(records)) throw new Error('Invalid model catalog');
  const byPair = new Map<string, Map<string, ModelFile[]>>();
  for (const record of records as Record<string, unknown>[]) {
    if (!record || typeof record !== 'object') continue;
    const { fromLang, toLang, version, fileType, name, filter_expression: filter } = record;
    const attachment = record.attachment as Record<string, unknown> | undefined;
    if (typeof fromLang !== 'string' || typeof toLang !== 'string' || !LANG.test(fromLang) || !LANG.test(toLang)) continue;
    if (typeof version !== 'string' || !STABLE_VERSION.test(version)) continue;
    if (filter) continue;
    if (!FILE_TYPES.includes(fileType as ModelFileType) || typeof name !== 'string' || !attachment) continue;
    const { location, hash, size } = attachment;
    if (typeof location !== 'string' || !LOCATION.test(location) || location.includes('..')) continue;
    if (typeof hash !== 'string' || !HASH.test(hash) || typeof size !== 'number' || size <= 0) continue;
    const pair = `${fromLang}|${toLang}`;
    const versions = byPair.get(pair) ?? new Map<string, ModelFile[]>();
    byPair.set(pair, versions);
    const files = versions.get(version) ?? [];
    versions.set(version, files);
    if (files.some((file) => file.fileType === fileType)) continue;
    files.push({ fileType: fileType as ModelFileType, name: name.replace(/[^A-Za-z0-9._-]/g, '_'), location, sha256: hash, size });
  }
  const sets: ModelSet[] = [];
  for (const [pair, versions] of byPair) {
    const [from, to] = pair.split('|');
    const newest = [...versions.keys()].filter((version) => isComplete(versions.get(version)!)).sort(compareVersions).at(-1);
    if (!newest) continue;
    sets.push({ from, to, version: newest, files: versions.get(newest)! });
  }
  return sets.sort((a, b) => `${a.from}-${a.to}`.localeCompare(`${b.from}-${b.to}`));
}

/**
 * Model chain for from→to: the direct pair, or a pivot through English (Mozilla publishes
 * xx↔en only). Empty when no path exists or from === to.
 */
export function route(sets: readonly ModelSet[], from: string, to: string): ModelSet[] {
  if (from === to) return [];
  const find = (a: string, b: string): ModelSet | undefined => sets.find((set) => set.from === a && set.to === b);
  const direct = find(from, to);
  if (direct) return [direct];
  if (from === 'en' || to === 'en') return [];
  const first = find(from, 'en');
  const second = find('en', to);
  return first && second ? [first, second] : [];
}

export function pairKey(set: Pick<ModelSet, 'from' | 'to'>): string {
  return `${set.from}-${set.to}`;
}

export function totalSize(set: ModelSet): number {
  return set.files.reduce((sum, file) => sum + file.size, 0);
}
