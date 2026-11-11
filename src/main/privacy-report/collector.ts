import { registrableDomain } from '../net/domain';
import { bump, dayKey, estimateBlockedBytes, type PrivacyCounter, type PrivacyDay } from '../../shared/privacy-report';

/**
 * Hot-path side of the privacy report: every protection calls these with a webContents id; they
 * only add to an in-memory map (no I/O, no IPC). privacy-report/index.ts drains it once a minute.
 * No Electron imports, so the network stages that call this stay unit-testable.
 */

export interface SpaceOfWebContents {
  spaceId: string;
  /** Burner Space: counted in the totals only (no per-Space row, no domains). */
  ephemeral: boolean;
}

type SpaceResolver = (webContentsId: number) => SpaceOfWebContents | null;
type PendingListener = () => void;

const pending = new Map<string, PrivacyDay>();
const RECENT_BLOCKED_MAX = 4096;
const recentBlocked = new Set<string>();
let resolveSpace: SpaceResolver = () => null;
let onPending: PendingListener = () => undefined;
let now: () => number = Date.now;

export function setPrivacySpaceResolver(resolver: SpaceResolver): void {
  resolveSpace = resolver;
}

/** Called after an increment (the owner starts its flush timer only when there is something to flush). */
export function setPrivacyPendingListener(listener: PendingListener): void {
  onPending = listener;
}

/** Tests only. */
export function setPrivacyClock(clock: () => number): void {
  now = clock;
}

function spaceOf(webContentsId: number | undefined): SpaceOfWebContents | null {
  if (!webContentsId || webContentsId <= 0) return null;
  try {
    return resolveSpace(webContentsId);
  } catch {
    return null;
  }
}

function record(counter: PrivacyCounter | (string & {}), amount: number, space: SpaceOfWebContents | null, domain?: string): void {
  bump(pending, dayKey(now()), {
    counter,
    amount,
    spaceId: space && !space.ephemeral ? space.spaceId : null,
    ...(domain && !space?.ephemeral ? { domain } : {}),
  });
  onPending();
}

/** A protection fired `amount` times for the tab/page with this webContents id (0/undefined: browser-level). */
export function countPrivacyEvent(counter: PrivacyCounter | (string & {}), webContentsId: number | undefined, amount = 1): void {
  try {
    record(counter, amount, spaceOf(webContentsId));
  } catch {
    /* counting must never break a request */
  }
}

/**
 * A tracker / ad request was blocked (Ghostery or an extension's declarativeNetRequest rule).
 * The same URL blocked again in the same tab before the next flush counts once: some pages retry a
 * blocked beacon in a tight loop (tens of thousands of hits a minute), which would drown the report.
 */
export function countBlockedRequest(webContentsId: number | undefined, url: string, resourceType: string | undefined): void {
  const key = `${webContentsId ?? 0} ${url}`;
  if (recentBlocked.has(key)) return;
  if (recentBlocked.size >= RECENT_BLOCKED_MAX) recentBlocked.clear();
  recentBlocked.add(key);
  try {
    const space = spaceOf(webContentsId);
    let domain: string | undefined;
    try {
      const host = new URL(url).hostname;
      domain = host ? registrableDomain(host) : undefined;
    } catch {
      domain = undefined;
    }
    record('trackersBlocked', 1, space, domain);
    record('bytesSaved', estimateBlockedBytes(resourceType), space);
  } catch {
    /* counting must never break a request */
  }
}

/** Hands the pending buckets to the caller and starts a fresh map. */
export function drainPrivacyPending(): PrivacyDay[] {
  const days = [...pending.values()];
  pending.clear();
  recentBlocked.clear();
  return days;
}

export function hasPrivacyPending(): boolean {
  return pending.size > 0;
}
