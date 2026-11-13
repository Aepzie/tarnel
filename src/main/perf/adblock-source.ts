/**
 * The Ghostery engine takes a request's source URL from `details.referrer`. That is empty whenever
 * the page suppresses the referrer (referrerPolicy 'no-referrer', rel=noreferrer, a Referrer-Policy
 * header ...), and without a source the engine can't tell first- from third-party, so every
 * $third-party rule is skipped. This picks the requesting document's URL instead. Pure, no electron.
 */

interface FrameLike {
  readonly url: string;
  readonly parent?: FrameLike | null;
}

export interface SourceDetails {
  readonly referrer: string;
  readonly resourceType?: string;
  readonly frame?: FrameLike | null;
  readonly webContents?: { getURL(): string } | null;
}

function webUrl(read: () => string | undefined): string {
  try {
    const url = read();
    return url && /^https?:/i.test(url) ? url : '';
  } catch {
    return ''; // frame / webContents already destroyed
  }
}

/**
 * The URL to use as the engine's source: the referrer when present; otherwise the requesting
 * document (for a subframe navigation its parent, else the request's frame), then the tab's URL.
 * Main-frame navigations have no source, as before.
 */
export function requestSourceUrl(details: SourceDetails): string {
  if (details.referrer || details.resourceType === 'mainFrame') return details.referrer;
  if (details.resourceType === 'subFrame') {
    const parent = webUrl(() => details.frame?.parent?.url);
    if (parent) return parent;
  } else {
    const frame = webUrl(() => details.frame?.url);
    if (frame) return frame;
  }
  return webUrl(() => details.webContents?.getURL());
}

/** `details` itself when nothing changes (no copy on the common path), else a shallow copy with the source filled in. */
export function withRequestSource<D extends SourceDetails>(details: D): D {
  if (details.referrer) return details;
  const source = requestSourceUrl(details);
  return source ? { ...details, referrer: source } : details;
}
