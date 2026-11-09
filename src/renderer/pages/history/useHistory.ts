import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryEntry } from '@shared/types';
import { settle, velaPages } from '@/lib/vela';

export const PAGE_SIZE = 100;

export type HistoryStatus = 'loading' | 'ready' | 'error';

interface HistoryState {
  entries: HistoryEntry[];
  status: HistoryStatus;
  /** True once the last page came back short (nothing older left). */
  done: boolean;
  loadingMore: boolean;
}

const hasBridge = (): boolean => typeof window.velaPages === 'object' && window.velaPages !== null;

export function useHistory(query: string) {
  const [state, setState] = useState<HistoryState>({ entries: [], status: 'loading', done: false, loadingMore: false });
  const generation = useRef(0);
  const latest = useRef(state);
  latest.current = state;
  const queryRef = useRef(query);
  queryRef.current = query;

  const reload = useCallback((q: string) => {
    const id = ++generation.current;
    if (!hasBridge()) {
      setState({ entries: [], status: 'error', done: true, loadingMore: false });
      return;
    }
    setState((current) => ({ ...current, status: current.entries.length ? current.status : 'loading', loadingMore: false }));
    velaPages()
      .history(q, PAGE_SIZE)
      .then((entries) => {
        if (id !== generation.current) return;
        setState({ entries, status: 'ready', done: entries.length < PAGE_SIZE, loadingMore: false });
      })
      .catch(() => {
        if (id !== generation.current) return;
        setState({ entries: [], status: 'error', done: true, loadingMore: false });
      });
  }, []);

  useEffect(() => reload(query), [query, reload]);

  useEffect(() => {
    const listeners = new AbortController();
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible' && latest.current.entries.length <= PAGE_SIZE) reload(queryRef.current);
      },
      { signal: listeners.signal },
    );
    return () => listeners.abort();
  }, [reload]);

  const loadMore = useCallback(() => {
    const current = latest.current;
    const last = current.entries[current.entries.length - 1];
    if (current.done || current.loadingMore || current.status !== 'ready' || !last) return;
    const id = generation.current;
    setState((s) => ({ ...s, loadingMore: true }));
    velaPages()
      .history(queryRef.current, PAGE_SIZE, last.lastVisit)
      .then((page) => {
        if (id !== generation.current) return;
        setState((s) => {
          const seen = new Set(s.entries.map((entry) => entry.url));
          const fresh = page.filter((entry) => !seen.has(entry.url));
          return { ...s, entries: [...s.entries, ...fresh], done: page.length < PAGE_SIZE, loadingMore: false };
        });
      })
      .catch(() => {
        if (id !== generation.current) return;
        setState((s) => ({ ...s, loadingMore: false, done: true }));
      });
  }, []);

  const remove = useCallback((url: string) => {
    setState((s) => ({ ...s, entries: s.entries.filter((entry) => entry.url !== url) }));
    settle(velaPages().deleteHistory(url));
  }, []);

  return { ...state, loadMore, remove };
}
