import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Eraser, History, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ease, spring } from '@/lib/motion';
import { settle, velaPages } from '@/lib/vela';
import { EmptyState } from './components/EmptyState';
import { HistoryRow } from './components/HistoryRow';
import { groupByDay } from './format';
import { useHistory } from './useHistory';

const SEARCH_DEBOUNCE_MS = 120;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Publishes the sticky header height as --header-h so day labels stick right below it. */
function useHeaderHeight() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => document.documentElement.style.setProperty('--header-h', `${node.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return ref;
}

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

const SKELETON_WIDTHS = ['46%', '62%', '38%', '55%', '70%', '42%', '58%', '34%'];

function RowSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading history" className="motion-safe:animate-pulse">
      <div className="mb-3 ml-4 h-3 w-16 rounded bg-muted" />
      {SKELETON_WIDTHS.map((width, index) => (
        <div key={index} className="flex h-10 items-center gap-3 px-3">
          <div className="h-2.5 w-9 rounded bg-muted/70" />
          <div className="size-4 rounded-[4px] bg-muted" />
          <div className="h-3 rounded bg-muted" style={{ width }} />
        </div>
      ))}
    </div>
  );
}

export function App() {
  const [input, setInput] = useState('');
  const query = useDebounced(input.trim(), SEARCH_DEBOUNCE_MS);
  const { entries, status, done, loadingMore, loadMore, remove } = useHistory(query);
  const deferredEntries = useDeferredValue(entries);
  const groups = useMemo(() => groupByDay(deferredEntries), [deferredEntries]);
  const [selected, setSelected] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const headerRef = useHeaderHeight();
  const keyboardNav = useRef(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const listeners = new AbortController();
    const update = () => setScrolled(window.scrollY > 4);
    update();
    window.addEventListener('scroll', update, { signal: listeners.signal, passive: true });
    return () => listeners.abort();
  }, []);

  useEffect(() => {
    document.title = 'History';
  }, []);

  useEffect(() => setSelected(null), [query]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((records) => records.some((r) => r.isIntersecting) && loadMore(), {
      rootMargin: '800px 0px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, status, done, entries.length]);

  const open = useCallback((url: string) => settle(velaPages().navigate(url)), []);

  const removeEntry = useCallback(
    (url: string) => {
      setSelected((current) => {
        if (current !== url) return current;
        const index = entries.findIndex((entry) => entry.url === url);
        return entries[index + 1]?.url ?? entries[index - 1]?.url ?? null;
      });
      remove(url);
    },
    [entries, remove],
  );

  const hover = useCallback((url: string) => {
    if (keyboardNav.current) return;
    setSelected(url);
  }, []);

  useEffect(() => {
    if (!selected || !keyboardNav.current) return;
    document.querySelector<HTMLElement>(`[data-url="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  useEffect(() => {
    const listeners = new AbortController();
    const move = (delta: number) => {
      if (entries.length === 0) return;
      keyboardNav.current = true;
      setSelected((current) => {
        const index = current ? entries.findIndex((entry) => entry.url === current) : -1;
        const next =
          index < 0 ? (delta > 0 ? 0 : entries.length - 1) : Math.min(entries.length - 1, Math.max(0, index + delta));
        return entries[next]?.url ?? null;
      });
    };
    window.addEventListener(
      'keydown',
      (event) => {
        const typing = isTypingTarget(event.target);
        const mod = event.ctrlKey || event.metaKey;
        if ((mod && event.key.toLowerCase() === 'f') || (!typing && event.key === '/')) {
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(event.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (event.key === 'Enter' && selected) {
          event.preventDefault();
          open(selected);
          return;
        }
        if (event.key === 'Delete' && selected && !(typing && input.length > 0)) {
          event.preventDefault();
          keyboardNav.current = true;
          removeEntry(selected);
          return;
        }
        if (event.key !== 'Escape') return;
        if (input) setInput('');
        else setSelected(null);
      },
      { signal: listeners.signal },
    );
    window.addEventListener(
      'mousemove',
      () => {
        keyboardNav.current = false;
      },
      { signal: listeners.signal, passive: true },
    );
    return () => listeners.abort();
  }, [entries, selected, input, open, removeEntry]);

  const showEmpty = status === 'error' || (status === 'ready' && entries.length === 0);
  const countLabel =
    status === 'ready' && entries.length > 0
      ? `${entries.length}${done ? '' : '+'} ${query ? 'matching ' : ''}${entries.length === 1 && done ? 'page' : 'pages'}`
      : 'Everything you visited, by day';

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate min-h-screen bg-background text-foreground">
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-72 left-1/2 size-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent-space)_13%,transparent),transparent)] blur-2xl" />
        </div>

        <header
          ref={headerRef}
          className={cn(
            'sticky top-0 z-20 transition-[background-color,backdrop-filter] duration-200',
            scrolled ? 'bg-background/80 backdrop-blur-xl backdrop-saturate-150' : 'bg-transparent',
          )}
        >
          <div className="mx-auto w-full max-w-3xl px-8 pt-10 pb-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-[11px] bg-card ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]">
                  <History className="size-[17px] text-space" strokeWidth={1.75} />
                </span>
                <div>
                  <h1 className="text-[20px] leading-tight font-semibold tracking-tight">History</h1>
                  <p className="text-[12px] text-muted-foreground tabular-nums">{countLabel}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => settle(velaPages().navigate('vela://settings/#privacy'))}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-[10px] px-3 text-[12.5px] font-medium text-muted-foreground',
                  'ring-1 ring-border transition-[background-color,color,transform] duration-150 outline-none',
                  'hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]',
                )}
              >
                <Eraser className="size-[14px]" strokeWidth={1.75} />
                Clear browsing data
              </button>
            </div>

            <label
              className={cn(
                'island mt-6 flex h-11 cursor-text items-center gap-3 rounded-full px-4 transition-shadow duration-200',
                'focus-within:shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-space)_45%,transparent),0_8px_28px_-10px_color-mix(in_oklab,var(--accent-space)_45%,transparent),inset_0_1px_0_var(--island-highlight)]',
              )}
            >
              <Search className="size-[16px] shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <input
                ref={searchRef}
                autoFocus
                value={input}
                onChange={(event) => setInput(event.target.value.slice(0, 200))}
                placeholder="Search history"
                spellCheck={false}
                aria-label="Search history"
                className="h-full min-w-0 flex-1 bg-transparent text-[14px] tracking-tight outline-none placeholder:text-muted-foreground/70"
              />
              <AnimatePresence initial={false} mode="popLayout">
                {input ? (
                  <motion.button
                    key="clear"
                    type="button"
                    aria-label="Clear search"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1, transition: spring.pop }}
                    exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1 } }}
                    onClick={() => {
                      setInput('');
                      searchRef.current?.focus();
                    }}
                    className="grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-[13px]" strokeWidth={2} />
                  </motion.button>
                ) : (
                  <motion.kbd
                    key="hint"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="grid h-5 min-w-5 place-items-center rounded-[5px] bg-secondary px-1.5 font-sans text-[10.5px] text-muted-foreground ring-1 ring-border"
                  >
                    /
                  </motion.kbd>
                )}
              </AnimatePresence>
            </label>
          </div>
          <div
            aria-hidden
            className={cn(
              'h-px bg-gradient-to-r from-transparent via-border to-transparent transition-opacity duration-200',
              scrolled ? 'opacity-100' : 'opacity-0',
            )}
          />
        </header>

        <main className="mx-auto w-full max-w-3xl px-8 pt-3 pb-24">
          {status === 'loading' && entries.length === 0 ? (
            <RowSkeleton />
          ) : showEmpty ? (
            <EmptyState query={query} error={status === 'error'} />
          ) : (
            <motion.div
              key={query}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: ease.out } }}
              role="listbox"
              aria-label="History"
            >
              <AnimatePresence initial={false}>
                {groups.map((group) => (
                  <motion.section
                    key={group.key}
                    layout="position"
                    transition={spring.snappy}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    className="mb-4"
                    aria-label={group.label}
                  >
                    <h2 className="sticky top-[var(--header-h,0px)] z-10 mb-0.5 flex items-center gap-3 rounded-lg bg-background/40 px-3 py-2 text-[11.5px] font-semibold tracking-wide text-foreground/70 backdrop-blur-lg">
                      <span>{group.label}</span>
                      <span className="h-px flex-1 bg-border/60" />
                      <span className="font-normal tabular-nums text-muted-foreground/60">{group.entries.length}</span>
                    </h2>
                    <ul>
                      <AnimatePresence initial={false}>
                        {group.entries.map((entry) => (
                          <HistoryRow
                            key={entry.url}
                            entry={entry}
                            selected={entry.url === selected}
                            onOpen={open}
                            onRemove={removeEntry}
                            onHover={hover}
                          />
                        ))}
                      </AnimatePresence>
                    </ul>
                  </motion.section>
                ))}
              </AnimatePresence>
              <div ref={sentinelRef} aria-hidden className="h-px" />
              {loadingMore && (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" strokeWidth={1.75} />
                </div>
              )}
              {done && entries.length > 20 && (
                <p className="py-8 text-center text-[12px] text-muted-foreground/60">That’s everything.</p>
              )}
            </motion.div>
          )}
        </main>
      </div>
    </MotionConfig>
  );
}
