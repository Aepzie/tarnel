import { app, net } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { InstalledModel } from '../../shared/translate';
import { CATALOG_URL, DEFAULT_ATTACHMENT_BASE, SERVER_URL, pairKey, parseCatalog, type ModelFile, type ModelSet } from './catalog';
import type { ModelPaths } from './engine-protocol';

const CATALOG_MAX_AGE_MS = 24 * 60 * 60_000;
const PAIR_DIR = /^[a-z]{2,3}(-[A-Za-z]{2,4})?-[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

interface CatalogCache {
  fetchedAt: number;
  base: string;
  sets: ModelSet[];
}

interface Manifest {
  from: string;
  to: string;
  version: string;
  files: { fileType: ModelFile['fileType']; name: string; sha256: string; size: number }[];
}

let catalog: CatalogCache | null = null;
let catalogLoading: Promise<CatalogCache> | null = null;
const downloads = new Map<string, Promise<void>>();

function root(): string {
  return path.join(app.getPath('userData'), 'translation-models');
}

function catalogFile(): string {
  return path.join(root(), 'catalog.json');
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await net.fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function readCachedCatalog(): Promise<CatalogCache | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(catalogFile(), 'utf8')) as CatalogCache;
    return Array.isArray(parsed.sets) && typeof parsed.base === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

async function downloadCatalog(): Promise<CatalogCache> {
  const [records, server] = await Promise.all([fetchJson(CATALOG_URL), fetchJson(SERVER_URL).catch(() => null)]);
  const base = (server as { capabilities?: { attachments?: { base_url?: unknown } } } | null)?.capabilities?.attachments?.base_url;
  const next: CatalogCache = {
    fetchedAt: Date.now(),
    base: typeof base === 'string' && base.startsWith('https://') ? base : DEFAULT_ATTACHMENT_BASE,
    sets: parseCatalog(records),
  };
  await fsp.mkdir(root(), { recursive: true });
  await fsp.writeFile(catalogFile(), JSON.stringify(next));
  return next;
}

/** Catalog of downloadable pairs: memory → disk cache (≤ 24 h) → Mozilla Remote Settings. */
export async function getCatalog(force = false): Promise<ModelSet[]> {
  if (catalog && !force && Date.now() - catalog.fetchedAt < CATALOG_MAX_AGE_MS) return catalog.sets;
  catalogLoading ??= (async () => {
    const cached = force ? null : await readCachedCatalog();
    if (cached && Date.now() - cached.fetchedAt < CATALOG_MAX_AGE_MS) return cached;
    try {
      return await downloadCatalog();
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  })().finally(() => {
    catalogLoading = null;
  });
  catalog = await catalogLoading;
  return catalog.sets;
}

/** Pairs known without touching the network (empty before the catalog was fetched once). */
export async function cachedSets(): Promise<ModelSet[]> {
  return catalog?.sets ?? (await readCachedCatalog())?.sets ?? [];
}

function pairDir(set: Pick<ModelSet, 'from' | 'to'>): string {
  return path.join(root(), pairKey(set));
}

function fileName(file: Pick<ModelFile, 'fileType' | 'name'>): string {
  return `${file.fileType}${path.extname(file.name) || '.bin'}`;
}

async function readManifest(dir: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

export async function isInstalled(set: ModelSet): Promise<boolean> {
  const manifest = await readManifest(pairDir(set));
  return manifest?.version === set.version;
}

async function downloadFile(url: string, file: ModelFile, target: string, onBytes: (bytes: number) => void): Promise<void> {
  const response = await net.fetch(url, { cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status})`);
  const partial = `${target}.part`;
  const hash = createHash('sha256');
  const out = fs.createWriteStream(partial);
  let received = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > file.size) throw new Error('Model file larger than announced');
      hash.update(value);
      if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', resolve));
      onBytes(value.byteLength);
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    if (hash.digest('hex') !== file.sha256) throw new Error(`Checksum mismatch for ${file.name}`);
    await fsp.rename(partial, target);
  } catch (error) {
    out.destroy();
    await fsp.rm(partial, { force: true });
    throw error;
  }
}

/** Downloads a pair (SHA-256 verified, atomic per file) unless it is already installed. */
export function ensureDownloaded(set: ModelSet, onProgress: (fraction: number) => void): Promise<void> {
  const key = pairKey(set);
  const running = downloads.get(key);
  if (running) return running;
  const job = (async () => {
    if (await isInstalled(set)) return;
    if (!catalog) await getCatalog();
    const base = catalog?.base ?? DEFAULT_ATTACHMENT_BASE;
    const dir = pairDir(set);
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    const total = set.files.reduce((sum, file) => sum + file.size, 0);
    let done = 0;
    for (const file of set.files) {
      await downloadFile(new URL(file.location, base).toString(), file, path.join(dir, fileName(file)), (bytes) => {
        done += bytes;
        onProgress(Math.min(1, done / total));
      });
    }
    const manifest: Manifest = { from: set.from, to: set.to, version: set.version, files: set.files.map(({ fileType, name, sha256, size }) => ({ fileType, name, sha256, size })) };
    await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  })().finally(() => downloads.delete(key));
  downloads.set(key, job);
  return job;
}

export function modelPaths(set: ModelSet): ModelPaths {
  const dir = pairDir(set);
  const find = (type: ModelFile['fileType']): string | null => {
    const file = set.files.find((entry) => entry.fileType === type);
    return file ? path.join(dir, fileName(file)) : null;
  };
  const vocab = find('vocab');
  return {
    model: find('model')!,
    lex: find('lex')!,
    vocabs: vocab ? [vocab] : [find('srcvocab')!, find('trgvocab')!],
  };
}

export async function listInstalled(): Promise<InstalledModel[]> {
  let names: string[];
  try {
    names = await fsp.readdir(root());
  } catch {
    return [];
  }
  const out: InstalledModel[] = [];
  for (const name of names.filter((entry) => PAIR_DIR.test(entry))) {
    const manifest = await readManifest(path.join(root(), name));
    if (!manifest) continue;
    out.push({ pair: name, from: manifest.from, to: manifest.to, version: manifest.version, bytes: manifest.files.reduce((sum, file) => sum + file.size, 0) });
  }
  return out.sort((a, b) => a.pair.localeCompare(b.pair));
}

export async function deleteInstalled(pair: string): Promise<void> {
  if (!PAIR_DIR.test(pair)) throw new TypeError('Invalid model pair');
  await fsp.rm(path.join(root(), pair), { recursive: true, force: true });
}
