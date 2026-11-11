export type InputKind = 'search' | 'url' | 'command';

const HOST_LIKE = /^(localhost|\[[0-9a-f:]+\]|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d{1,5})?([/?#]\S*)?$/i;

export function looksLikeUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return false;
  if (/^(vela|about|file|data):/i.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\/\S/i.test(value)) return true;
  return HOST_LIKE.test(value);
}

export function classifyInput(raw: string): InputKind {
  if (raw.trimStart().startsWith('>')) return 'command';
  return looksLikeUrl(raw) ? 'url' : 'search';
}

/** Absolute URL suitable for `vela.preconnect`, or null when the value is not URL-ish. */
export function preconnectTarget(raw: string): string | null {
  const value = raw.trim();
  if (!looksLikeUrl(value)) return null;
  if (/^(vela|about|file|data):/i.test(value)) return null;
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  return /^https?:\/\//i.test(absolute) ? absolute : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function displayUrl(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'vela:') return { host: `vela://${parsed.hostname}`, path: parsed.pathname === '/' ? '' : parsed.pathname };
    if (parsed.protocol === 'file:') return { host: 'file', path: safeDecode(parsed.pathname) };
    const path = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
    return { host: parsed.hostname.replace(/^www\./, ''), path: path.length > 64 ? `${path.slice(0, 63)}…` : path };
  } catch {
    return { host: url, path: '' };
  }
}
