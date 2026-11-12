import { readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';

/**
 * Redirect targets inside the extension (`redirect.extensionPath`).
 *
 * Resources listed in web_accessible_resources with `use_dynamic_url: true` may only be loaded
 * through the extension's per-session dynamic URL, which Electron neither exposes nor routes; a
 * redirect to the static `chrome-extension://<id>/…` URL fails with ERR_BLOCKED_BY_CLIENT (this is
 * what uBlock Origin Lite's surrogate scripts declare). For sub-resources such targets are served
 * as a `data:` URL with the file's contents instead, as Tarnel's own blocker does for its
 * surrogates. Frames keep the extension URL (a data: frame would get an opaque origin).
 */

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'text/xml',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const MAX_INLINE_BYTES = 256 * 1024;

interface WarEntry {
  resources?: unknown;
  use_dynamic_url?: unknown;
}

function globToRegExp(glob: string): RegExp {
  const source = glob.replace(/^\/+/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`);
}

export class RedirectResources {
  private readonly dynamic: RegExp[] = [];
  private readonly cache = new Map<string, string | null>();
  private readonly prefix: string;

  constructor(
    extensionId: string,
    private readonly root: string,
    manifest: { web_accessible_resources?: unknown },
  ) {
    this.prefix = `chrome-extension://${extensionId}/`;
    const entries = Array.isArray(manifest.web_accessible_resources) ? (manifest.web_accessible_resources as WarEntry[]) : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || entry.use_dynamic_url !== true || !Array.isArray(entry.resources)) continue;
      for (const resource of entry.resources) if (typeof resource === 'string') this.dynamic.push(globToRegExp(resource));
    }
  }

  /** The URL to redirect a sub-resource (or frame, when `frame`) to. */
  target(url: string, frame: boolean): string {
    if (frame || this.dynamic.length === 0 || !url.startsWith(this.prefix)) return url;
    const path = decodeURIComponent(url.slice(this.prefix.length).split(/[?#]/, 1)[0]!);
    if (!this.dynamic.some((pattern) => pattern.test(path))) return url;
    let data = this.cache.get(path);
    if (data === undefined) {
      data = this.inline(path);
      this.cache.set(path, data);
    }
    return data ?? url;
  }

  private inline(path: string): string | null {
    const file = resolve(this.root, path);
    const inside = relative(this.root, file);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null;
    try {
      if (statSync(file).size > MAX_INLINE_BYTES) return null;
      const mime = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
      return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
    } catch {
      return null;
    }
  }
}
