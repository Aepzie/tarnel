import { net, type Session } from 'electron';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { INTERNAL_SCHEME, LEGACY_INTERNAL_SCHEME, canonicalInternalUrl } from '../shared/internal-url';

export { INTERNAL_SCHEME, LEGACY_INTERNAL_SCHEME };

/** dist/main/index.js → dist/renderer */
const RENDERER_ROOT = resolve(__dirname, '..', 'renderer');
const registered = new WeakSet<Session>();
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

function resolveTarget(requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9-]+$/.test(host)) return null;
  const base = host === 'shared' ? join(RENDERER_ROOT, 'shared') : join(RENDERER_ROOT, 'pages', host);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  // Vite emits shared chunks to dist/renderer/assets; pages reference them relatively, which
  // resolves to tarnel://<page>/assets/* — served for every host so modules stay same-origin.
  if (path.startsWith('/assets/')) {
    const assetsRoot = join(RENDERER_ROOT, 'assets');
    const asset = resolve(assetsRoot, '.' + path.slice('/assets'.length));
    return asset.startsWith(assetsRoot + sep) ? asset : null;
  }
  if (path === '' || path.endsWith('/')) path += 'index.html';
  const target = resolve(base, '.' + path);
  return target.startsWith(base + sep) ? target : null;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/**
 * vela:// (the scheme before the rename) answers with a redirect to the same tarnel:// page. The
 * body repeats it as a meta refresh in case a loader does not follow custom-scheme redirects;
 * tabs.ts also rewrites vela:// navigations before they get here.
 */
function legacyRedirect(requestUrl: string): Response {
  const target = canonicalInternalUrl(requestUrl);
  const body = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">`;
  return new Response(body, {
    status: 302,
    headers: {
      location: target,
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

export function registerInternalProtocol(session: Session): void {
  if (registered.has(session)) return;
  registered.add(session);
  session.protocol.handle(LEGACY_INTERNAL_SCHEME, async (request) => legacyRedirect(request.url));
  session.protocol.handle(INTERNAL_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return notFound();
    const target = resolveTarget(request.url);
    if (!target) return notFound();
    try {
      if (!(await stat(target)).isFile()) return notFound();
      const file = await net.fetch(pathToFileURL(target).toString());
      const headers = new Headers(file.headers);
      headers.set('content-type', MIME[extname(target).toLowerCase()] ?? 'application/octet-stream');
      headers.set('x-content-type-options', 'nosniff');
      // Internal pages must never be embedded by web content (clickjacking / spoofing).
      headers.set('x-frame-options', 'DENY');
      headers.set('content-security-policy', "frame-ancestors 'none'");
      return new Response(file.body, { status: file.status, headers });
    } catch {
      return notFound();
    }
  });
}
