import { useSyncExternalStore } from 'react';
import type { DownloadState } from '@shared/types';

export interface DownloadEntry {
  download: DownloadState;
  /** Smoothed transfer rate in bytes/s (0 when unknown or finished). */
  rate: number;
}

export interface DownloadsSnapshot {
  /** Newest first. */
  entries: DownloadEntry[];
  /** A download finished since the list was last opened. */
  unseen: boolean;
  /** Increments on every completion; drives the button's check pulse. */
  completions: number;
}

interface Sample {
  bytes: number;
  at: number;
}

/**
 * Session-scoped downloads store. Subscribes to `vela.onDownload` once at module level so state
 * survives component remounts (e.g. the island hiding in focus mode).
 */
let snapshot: DownloadsSnapshot = { entries: [], unseen: false, completions: 0 };
const samples = new Map<string, Sample>();
const dismissed = new Set<string>();
const listeners = new Set<() => void>();
let started = false;

function emit(next: DownloadsSnapshot): void {
  snapshot = next;
  listeners.forEach((cb) => cb());
}

function isFinished(download: DownloadState): boolean {
  return download.state !== 'progressing';
}

function onDownload(download: DownloadState): void {
  if (dismissed.has(download.id)) return;
  const now = performance.now();
  const index = snapshot.entries.findIndex((entry) => entry.download.id === download.id);
  const previous = index === -1 ? undefined : snapshot.entries[index];

  let rate = previous?.rate ?? 0;
  if (isFinished(download)) {
    rate = 0;
    samples.delete(download.id);
  } else {
    const sample = samples.get(download.id);
    if (!sample) samples.set(download.id, { bytes: download.receivedBytes, at: now });
    else if (now - sample.at >= 250) {
      const instant = Math.max(0, download.receivedBytes - sample.bytes) / ((now - sample.at) / 1000);
      rate = rate === 0 ? instant : rate * 0.7 + instant * 0.3;
      samples.set(download.id, { bytes: download.receivedBytes, at: now });
    }
  }

  const entry: DownloadEntry = { download, rate };
  const entries = snapshot.entries.slice();
  if (index === -1) entries.unshift(entry);
  else entries[index] = entry;

  const justCompleted = download.state === 'completed' && previous?.download.state !== 'completed';
  emit({
    entries,
    unseen: snapshot.unseen || justCompleted,
    completions: snapshot.completions + (justCompleted ? 1 : 0),
  });
}

function start(): void {
  if (started || !window.vela) return;
  started = true;
  window.vela.onDownload(onDownload);
}

export const downloads = {
  dismiss(id: string): void {
    dismissed.add(id);
    samples.delete(id);
    emit({ ...snapshot, entries: snapshot.entries.filter((entry) => entry.download.id !== id) });
  },
  /** Removes finished downloads; in-progress ones stay. */
  clearFinished(): void {
    const keep = snapshot.entries.filter((entry) => {
      if (!isFinished(entry.download)) return true;
      dismissed.add(entry.download.id);
      return false;
    });
    emit({ ...snapshot, entries: keep, unseen: false });
  },
  markSeen(): void {
    if (snapshot.unseen) emit({ ...snapshot, unseen: false });
  },
};

export function useDownloads(): DownloadsSnapshot {
  start();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}

export interface AggregateProgress {
  active: number;
  /** 0..1, or null when no active download reports a total size. */
  ratio: number | null;
}

export function aggregateProgress(entries: DownloadEntry[]): AggregateProgress {
  const active = entries.filter((entry) => !isFinished(entry.download));
  const sized = active.filter((entry) => entry.download.totalBytes > 0);
  if (sized.length === 0) return { active: active.length, ratio: null };
  const received = sized.reduce((sum, entry) => sum + entry.download.receivedBytes, 0);
  const total = sized.reduce((sum, entry) => sum + entry.download.totalBytes, 0);
  return { active: active.length, ratio: Math.min(1, received / total) };
}
