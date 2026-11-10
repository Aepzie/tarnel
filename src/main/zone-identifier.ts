/**
 * Mark-of-the-Web: the `Zone.Identifier` alternate data stream Windows reads to decide whether a
 * file came from the internet (SmartScreen, Defender, Office Protected View, "Unblock" in
 * Properties). Pure formatter so it can be unit-tested without Electron or NTFS.
 */

/** URLZONE_INTERNET. */
export const INTERNET_ZONE = 3;

/** Only http(s) URLs are recorded, without credentials or fragment; anything else is omitted. */
export function zoneUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.username = '';
  url.password = '';
  url.hash = '';
  const text = url.toString();
  return /[\r\n]/.test(text) ? null : text;
}

export interface ZoneIdentifierInput {
  /** Final download URL (HostUrl). */
  hostUrl?: string | null;
  /** Page that started the download (ReferrerUrl). */
  referrerUrl?: string | null;
  /** False for burner / in-memory sessions: write the zone only, never the URLs. */
  includeUrls?: boolean;
}

/** Contents of `<file>:Zone.Identifier`, CRLF line endings like Chrome and Edge write it. */
export function formatZoneIdentifier({ hostUrl, referrerUrl, includeUrls = true }: ZoneIdentifierInput): string {
  const lines = ['[ZoneTransfer]', `ZoneId=${INTERNET_ZONE}`];
  if (includeUrls) {
    const referrer = zoneUrl(referrerUrl);
    const host = zoneUrl(hostUrl);
    if (referrer) lines.push(`ReferrerUrl=${referrer}`);
    if (host) lines.push(`HostUrl=${host}`);
  }
  return `${lines.join('\r\n')}\r\n`;
}
