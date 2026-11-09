import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import type { FindResult } from '@shared/types';
import { useBrowserSlice } from '@/hooks/browser';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ui, useChromeUI, type ChromeUIState } from '../ui-store';
import { settle } from '@/lib/vela';

const DEBOUNCE_MS = 60;
const STRIP_HEIGHT = 40;
/** The App column uses gap-2; collapse it together with the strip so the viewport moves by exactly 48px. */
const GAP = 8;

/**
 * In-flow find strip between the top island and the viewport. Its height animates 0 ↔ 40, so the
 * viewport (and therefore the page view) shrinks smoothly — no overlay needed.
 */
export function FindBar() {
  const { find } = useChromeUI();
  const tabId = useBrowserSlice((s) => s.activeTabId);
  const reduce = useReducedMotion();
  
  const lastTab = useRef(tabId);
  useEffect(() => {
    if (lastTab.current !== tabId && find.open) ui.closeFind();
    lastTab.current = tabId;
  }, [tabId, find.open]);

  return (
    <AnimatePresence initial={false}>
      {find.open && tabId !== null && (
        <motion.div
          key="find"
          className="relative z-10 shrink-0"
          initial={{ height: 0, marginBottom: -GAP }}
          animate={{ height: STRIP_HEIGHT, marginBottom: 0 }}
          exit={{ height: 0, marginBottom: -GAP }}
          transition={reduce ? { duration: 0 } : spring.snappy}
        >
          <FindStrip tabId={tabId} find={find} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FindStrip({ tabId, find }: { tabId: number; find: ChromeUIState['find'] }) {
  const reduce = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<FindResult | null>(null);
  const timer = useRef(0);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    const input = inputRef.current;
    input?.focus({ preventScroll: true });
    input?.select();
  }, [find]);

  useEffect(
    () =>
      window.vela.onFindResult((next) => {
        if (next.tabId === tabId && textRef.current) setResult(next);
      }),
    [tabId],
  );

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      settle(window.vela.tabs.stopFind(tabId));
    },
    [tabId],
  );

  const search = (value: string, forward: boolean): void => {
    window.clearTimeout(timer.current);
    if (!value) {
      setResult(null);
      settle(window.vela.tabs.stopFind(tabId));
      return;
    }
    settle(window.vela.tabs.find(tabId, value, forward));
  };

  const onChange = (value: string): void => {
    setText(value);
    window.clearTimeout(timer.current);
    if (!value) {
      search('', true);
      return;
    }
    timer.current = window.setTimeout(() => search(value, true), DEBOUNCE_MS);
  };

  const close = (): void => ui.closeFind();

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    search(text, !event.shiftKey);
  };

  const noMatch = !!text && result !== null && result.matches === 0;
  const label = !text || result === null ? '' : result.matches === 0 ? 'No results' : `${result.activeMatchOrdinal} / ${result.matches}`;

  return (
    <motion.div
      role="search"
      aria-label="Find in page"
      className={cn(
        'island no-drag flex h-10 items-center gap-1 rounded-xl! pr-1.5 pl-3 transition-[background-color,box-shadow] duration-200',
        noMatch && 'bg-[color-mix(in_oklab,var(--island)_82%,var(--destructive))]! shadow-[0_0_0_1px_color-mix(in_oklab,var(--destructive)_45%,transparent),inset_0_1px_0_var(--island-highlight)]!',
      )}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.985, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.985, filter: 'blur(4px)', transition: { duration: 0.14, ease: ease.out } }}
      transition={spring.soft}
    >
      <Search
        className={cn('size-3.5 shrink-0 transition-colors', noMatch ? 'text-destructive' : 'text-muted-foreground')}
        strokeWidth={1.75}
      />
      <input
        ref={inputRef}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in page"
        aria-label="Find in page"
        spellCheck={false}
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[13px] tracking-tight text-foreground outline-none placeholder:text-muted-foreground/70"
      />
      <span
        aria-live="polite"
        className={cn(
          'relative mr-1 grid h-5 min-w-12 place-items-end overflow-hidden text-right text-[12px] tabular-nums',
          noMatch ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={label}
            className="col-start-1 row-start-1 leading-5 whitespace-nowrap"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.14, ease: ease.out }}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <StripButton label="Previous match (Shift+Enter)" disabled={!text} onClick={() => search(text, false)}>
        <ChevronUp className="size-4" strokeWidth={1.75} />
      </StripButton>
      <StripButton label="Next match (Enter)" disabled={!text} onClick={() => search(text, true)}>
        <ChevronDown className="size-4" strokeWidth={1.75} />
      </StripButton>
      <StripButton label="Close (Esc)" onClick={close}>
        <X className="size-3.5" strokeWidth={1.75} />
      </StripButton>
    </motion.div>
  );
}

function StripButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
