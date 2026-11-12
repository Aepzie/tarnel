/**
 * User-Agent overrides: one global value in Settings, optionally overridden per Space.
 * '' means "not set" (the Space follows the global value; the global value follows Tarnel's clean
 * Chromium UA). Values are free strings but must be a valid HTTP header value.
 */

export const USER_AGENT_MAX = 512;

export interface UserAgentPreset {
  label: string;
  value: string;
}

/** Printable ASCII only: the value goes into the User-Agent header verbatim. */
export function isValidUserAgent(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.trim().length <= USER_AGENT_MAX && /^[\x20-\x7E]*$/.test(raw);
}

/** Trimmed value, `fallback` when missing; throws on anything that is not a valid header value. */
export function cleanUserAgentValue(raw: unknown, fallback = ''): string {
  if (raw === undefined || raw === null) return fallback;
  if (!isValidUserAgent(raw)) throw new Error('Invalid user agent');
  return raw.trim();
}

/**
 * Common desktop and mobile UAs. Chrome-based entries use Tarnel's own Chromium major (frozen
 * "<major>.0.0.0", as real Chromium sends) so they match the Sec-CH-UA brand list.
 */
export function userAgentPresets(chromeMajor: number): UserAgentPreset[] {
  const m = Number.isInteger(chromeMajor) && chromeMajor > 0 ? chromeMajor : 140;
  // shortcut: Firefox ships on the same 4-week cadence about 3 versions ahead; Safari is pinned, bump with Safari majors.
  const ff = m + 3;
  const chrome = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${m}.0.0.0`;
  return [
    { label: 'Chrome · Windows', value: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome} Safari/537.36` },
    { label: 'Chrome · macOS', value: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${chrome} Safari/537.36` },
    { label: 'Chrome · Linux', value: `Mozilla/5.0 (X11; Linux x86_64) ${chrome} Safari/537.36` },
    { label: 'Chrome · Android', value: `Mozilla/5.0 (Linux; Android 10; K) ${chrome} Mobile Safari/537.36` },
    { label: 'Edge · Windows', value: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome} Safari/537.36 Edg/${m}.0.0.0` },
    { label: 'Firefox · Windows', value: `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${ff}.0) Gecko/20100101 Firefox/${ff}.0` },
    { label: 'Firefox · macOS', value: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${ff}.0) Gecko/20100101 Firefox/${ff}.0` },
    { label: 'Firefox · Linux', value: `Mozilla/5.0 (X11; Linux x86_64; rv:${ff}.0) Gecko/20100101 Firefox/${ff}.0` },
    { label: 'Safari · macOS', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15' },
    { label: 'Safari · iPhone', value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' },
  ];
}

/** A random preset, never `current` (so the button always changes something). */
export function randomUserAgent(presets: readonly UserAgentPreset[], current: string, random: () => number = Math.random): string {
  const pool = presets.filter((preset) => preset.value !== current);
  if (pool.length === 0) return current;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!.value;
}
