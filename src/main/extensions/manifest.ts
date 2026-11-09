import { nativeImage } from 'electron';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** The subset of manifest.json Vela reads itself (Chromium parses the rest). */
interface RawManifest {
  manifest_version?: number;
  name?: string;
  version?: string;
  description?: string;
  default_locale?: string;
  icons?: Record<string, string>;
  action?: { default_icon?: string | Record<string, string> };
  browser_action?: { default_icon?: string | Record<string, string> };
  options_page?: string;
  options_ui?: { page?: string };
}

export interface ManifestMeta {
  name: string;
  version: string;
  description: string;
}

export interface StaticInfo {
  /** Manifest icon as a 32px PNG data: URL. */
  icon: string | null;
  /** Options page path relative to the extension root. */
  optionsPage: string | null;
}

const ICON_SIZE = 32;
const NAME_MAX = 64;
const DESCRIPTION_MAX = 240;
const infoCache = new Map<string, StaticInfo>();

/** JSON.parse that tolerates the UTF-8 BOM many extension files ship with. */
function parseJson(text: string): unknown {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

export async function readManifest(dir: string): Promise<RawManifest> {
  let raw: string;
  try {
    raw = await readFile(join(dir, 'manifest.json'), 'utf8');
  } catch {
    throw new Error('No manifest.json in that folder');
  }
  let parsed: unknown;
  try {
    parsed = parseJson(raw);
  } catch {
    throw new Error('manifest.json is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('manifest.json is not valid JSON');
  return parsed as RawManifest;
}

/** Resolves `__MSG_name__` placeholders from _locales (default locale, then English). */
async function localize(dir: string, manifest: RawManifest, value: string | undefined): Promise<string> {
  const text = typeof value === 'string' ? value : '';
  const match = /^__MSG_(\w+)__$/.exec(text.trim());
  if (!match) return text;
  const key = match[1]!.toLowerCase();
  const locales = [manifest.default_locale, 'en', 'en_US'].filter(
    (locale): locale is string => typeof locale === 'string' && /^[\w-]{1,16}$/.test(locale),
  );
  for (const locale of locales) {
    try {
      const messages = parseJson(await readFile(join(dir, '_locales', locale, 'messages.json'), 'utf8')) as Record<
        string,
        { message?: unknown }
      >;
      const found = Object.entries(messages).find(([name]) => name.toLowerCase() === key)?.[1]?.message;
      if (typeof found === 'string') return found;
    } catch {
      /* try the next locale */
    }
  }
  return text;
}

export async function readMeta(dir: string): Promise<ManifestMeta> {
  const manifest = await readManifest(dir);
  if (typeof manifest.version !== 'string' || !manifest.version) throw new Error('manifest.json has no version');
  const name = (await localize(dir, manifest, manifest.name)).trim().slice(0, NAME_MAX);
  const description = (await localize(dir, manifest, manifest.description)).trim().slice(0, DESCRIPTION_MAX);
  return { name: name || 'Extension', version: manifest.version, description };
}

function inside(dir: string, relative: string): string | null {
  const base = resolve(dir);
  const target = resolve(base, relative.replace(/^\/+/, ''));
  return target.startsWith(base + sep) ? target : null;
}

function pickIcon(icons: Record<string, string> | string | undefined): string | null {
  if (typeof icons === 'string') return icons;
  if (!icons || typeof icons !== 'object') return null;
  const sizes = Object.keys(icons)
    .map(Number)
    .filter((size) => Number.isFinite(size) && typeof icons[String(size)] === 'string')
    .sort((a, b) => a - b);
  const size = sizes.find((s) => s >= ICON_SIZE) ?? sizes[sizes.length - 1];
  return size === undefined ? null : (icons[String(size)] ?? null);
}

function manifestSync(dir: string): RawManifest | null {
  try {
    return parseJson(readFileSync(join(dir, 'manifest.json'), 'utf8')) as RawManifest;
  } catch {
    return null;
  }
}

/** Icon + options page, read once per extension directory. */
export function staticInfo(dir: string): StaticInfo {
  const cached = infoCache.get(dir);
  if (cached) return cached;
  const manifest = manifestSync(dir);
  const relative =
    pickIcon(manifest?.icons) ?? pickIcon(manifest?.action?.default_icon) ?? pickIcon(manifest?.browser_action?.default_icon);
  const file = relative ? inside(dir, relative) : null;
  let icon: string | null = null;
  if (file) {
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) icon = image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' }).toDataURL();
  }
  const page = manifest?.options_ui?.page ?? manifest?.options_page;
  const optionsPage = typeof page === 'string' && page && inside(dir, page) ? page.replace(/^\/+/, '') : null;
  const info = { icon, optionsPage };
  infoCache.set(dir, info);
  return info;
}

export function forgetManifest(dir: string): void {
  infoCache.delete(dir);
}
