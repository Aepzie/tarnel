import { useEffect, useRef, useState } from 'react';
import type { Suggestion } from '@shared/types';

const DEBOUNCE_MS = 40;

export interface SuggestionResult {
  /** Query the suggestions were computed for. */
  query: string;
  items: Suggestion[];
}

const EMPTY: SuggestionResult = { query: '', items: [] };

/**
 * Debounced, server-ranked suggestions. Every keystroke bumps a request sequence; responses that
 * come back for an older sequence are dropped so results never jump backwards. The hook is mounted
 * fresh each time the palette opens, which resets the sequence and any pending debounce.
 */
export function useSuggestions(query: string, enabled: boolean): SuggestionResult {
  const [result, setResult] = useState<SuggestionResult>(EMPTY);
  const seq = useRef(0);

  useEffect(() => {
    const current = ++seq.current;
    const text = query.trim();
    if (!enabled || !text) {
      setResult(EMPTY);
      return;
    }
    const timer = window.setTimeout(() => {
      window.vela
        .suggest(text)
        .then((items) => {
          if (current === seq.current) setResult({ query: text, items });
        })
        .catch(() => {
          if (current === seq.current) setResult({ query: text, items: [] });
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, enabled]);

  useEffect(
    () => () => {
      seq.current += 1;
    },
    [],
  );

  return result;
}
