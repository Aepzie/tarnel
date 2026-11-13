import type { CustomScheme, Session } from 'electron';

/**
 * `$redirect=` resources (neutered gpt.js, analytics.js, noop.js, 1x1.gif …) served from a privileged
 * custom scheme instead of the `data:` URL Ghostery hands to webRequest: Chromium refuses a webRequest
 * redirect to `data:` (net::ERR_UNSAFE_REDIRECT), so the page saw a network error instead of the stub.
 * Bodies come from the engine's already loaded resources; nothing runs unless a redirect rule matches.
 *
 * Electron-free apart from types, so it is unit-testable.
 */

export const REDIRECT_SCHEME = 'tarnel-res';
const HOST = 'r';
const PREFIX = `${REDIRECT_SCHEME}://${HOST}/`;

/** bypassCSP: the stub replaces a script the page's CSP already allowed; Chromium checks CSP again on the redirect target. */
export const REDIRECT_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: REDIRECT_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true },
};

export interface RedirectResource {
  filename?: string;
  dataUrl: string;
}

interface Resources {
  getResource(name: string): RedirectResource;
}

interface Matcher<R extends { type: string }> {
  match(request: R): { match: boolean; redirect?: RedirectResource };
}

/** The custom-scheme URL for a named resource; unnamed (MIME-fallback) resources keep their data: URL. */
export function redirectUrlFor(redirect: RedirectResource): string {
  if (!redirect.filename) return redirect.dataUrl;
  return PREFIX + encodeURIComponent(redirect.filename);
}

export function resourceNameOf(url: string): string | null {
  if (!url.startsWith(PREFIX)) return null;
  const encoded = url.slice(PREFIX.length).split(/[?#]/, 1)[0];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function decodeDataUrl(dataUrl: string): { mimeType: string; body: Uint8Array } | null {
  if (!dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const meta = dataUrl.slice(5, comma).split(';');
  const payload = dataUrl.slice(comma + 1);
  const base64 = meta.includes('base64');
  const mimeType = meta.filter((part) => part !== 'base64').join(';') || 'text/plain';
  if (base64) return { mimeType, body: new Uint8Array(Buffer.from(payload, 'base64')) };
  let text: string;
  try {
    text = decodeURIComponent(payload);
  } catch {
    text = payload;
  }
  return { mimeType, body: new Uint8Array(Buffer.from(text, 'utf8')) };
}

/**
 * Make the engine hand out custom-scheme redirect targets (its webRequest listener uses `redirect.dataUrl`), for
 * scripts only: a stub keeps pages that call gpt.js / analytics.js working. Every other type (xhr, image, media,
 * frames …) is blocked as before, so ad probes like `||doubleclick.net^$xhr,redirect=noop.txt` keep failing instead
 * of looking reachable. The engine already emitted `request-redirected` for the match, so stats stay one per request.
 */
export function rewriteRedirects<R extends { type: string }>(engine: Matcher<R>): void {
  const match = engine.match.bind(engine);
  engine.match = (request: R) => {
    const result = match(request);
    const redirect = result.redirect;
    if (!redirect) return result;
    if (request.type !== 'script') return { ...result, match: true, redirect: undefined };
    return { ...result, redirect: { ...redirect, dataUrl: redirectUrlFor(redirect) } };
  };
}

export function redirectResponse(url: string, resources: Resources | null | undefined): Response {
  const name = resourceNameOf(url);
  const decoded = name && resources ? decodeDataUrl(resources.getResource(name).dataUrl) : null;
  if (!decoded) return new Response(null, { status: 404 });
  return new Response(decoded.body as BodyInit, {
    status: 200,
    headers: {
      'content-type': decoded.mimeType,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

const served = new WeakSet<Session>();

export function serveRedirectResources(session: Session, resources: () => Resources | null | undefined): void {
  if (served.has(session)) return;
  served.add(session);
  session.protocol.handle(REDIRECT_SCHEME, (request) => {
    try {
      return redirectResponse(request.url, resources());
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
