import type { Session } from 'electron';

export interface HeaderProfile {
  strict: boolean;
  /** Spoofed navigator.deviceMemory, mirrored into Device-Memory hints. */
  memory: number;
}

const profiles = new WeakMap<Session, HeaderProfile>();

export function setHeaderProfile(session: Session, profile: HeaderProfile | null): void {
  if (profile) profiles.set(session, profile);
  else profiles.delete(session);
}

/** "140.0.7339.133" → "140.0.0.0" (what Chrome's reduced User-Agent already says). */
function reducedVersion(version: string): string {
  return `${version.split('.')[0] ?? '0'}.0.0.0`;
}

/** "10.0.19045" → "10.0.0". */
function reducedPlatformVersion(version: string): string {
  return `${version.split('.')[0] ?? '0'}.0.0`;
}

function unquote(value: string): string {
  return value.replace(/^"|"$/g, '');
}

/**
 * Keeps request headers consistent with the main-world patch: Device-Memory always matches
 * navigator.deviceMemory; in strict mode the high-entropy UA client hints are reduced the same way
 * NavigatorUAData.getHighEntropyValues() is. Called from privacy.ts' onBeforeSendHeaders (one
 * listener per session).
 */
export function applyFingerprintHeaders(session: Session, headers: Record<string, string>): void {
  const profile = profiles.get(session);
  if (!profile) return;
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'device-memory' || lower === 'sec-ch-device-memory') {
      headers[name] = String(profile.memory);
      continue;
    }
    if (!profile.strict || !lower.startsWith('sec-ch-ua-')) continue;
    const value = headers[name] ?? '';
    if (lower === 'sec-ch-ua-full-version-list') headers[name] = value.replace(/v="(\d+)[^"]*"/g, (_m, major: string) => `v="${major}.0.0.0"`);
    else if (lower === 'sec-ch-ua-full-version') headers[name] = `"${reducedVersion(unquote(value))}"`;
    else if (lower === 'sec-ch-ua-platform-version') headers[name] = `"${reducedPlatformVersion(unquote(value))}"`;
    else if (lower === 'sec-ch-ua-model') headers[name] = '""';
    else if (lower === 'sec-ch-ua-wow64') headers[name] = '?0';
  }
}
