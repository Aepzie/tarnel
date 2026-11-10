import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ease } from '@/lib/motion';
import { velaPages } from '@/lib/vela';
import { hasBridge } from '../theme';

const hintMotion = {
  initial: { opacity: 0, scale: 0.9, filter: 'blur(2px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.9, filter: 'blur(2px)' },
  transition: { duration: 0.16, ease: ease.out },
};

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-foreground/[0.06] px-1.5 font-sans text-[11px] font-medium text-muted-foreground ring-1 ring-foreground/[0.06] ring-inset">
      {children}
    </kbd>
  );
}

export function SearchBar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const input = inputRef.current;
      if (!input) return;
      const isCtrlK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      const isSlash = event.key === '/' && document.activeElement !== input;
      if (!isCtrlK && !isSlash) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    // Main focuses this page when its tab becomes active; land in the search box unless something else has focus.
    const onFocus = (): void => {
      if (document.activeElement === document.body || document.activeElement === null) inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const query = value.trim();
    if (!query || !hasBridge()) return;
    void velaPages().navigate(query);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') setValue('');
  };

  const typing = value.trim().length > 0;

  return (
    <form role="search" onSubmit={submit} className="w-[min(640px,90vw)]">
      <label
        className="island group relative flex h-14 cursor-text items-center gap-3 rounded-full! pr-3 pl-5 transition-[box-shadow,background-color] duration-200 ease-out focus-within:shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-space)_55%,transparent),inset_0_1px_0_var(--island-highlight),0_16px_48px_-12px_color-mix(in_oklab,var(--accent-space)_40%,transparent),0_0_0_5px_color-mix(in_oklab,var(--accent-space)_14%,transparent)]"
      >
        <Search
          size={18}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground transition-colors duration-200 group-focus-within:text-space"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          type="text"
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Search the web or type a URL"
          placeholder="Search the web or type a URL"
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] tracking-tight text-foreground caret-[var(--accent-space)] outline-none placeholder:text-muted-foreground/70"
        />
        <span className="relative flex h-7 w-16 shrink-0 items-center justify-end" aria-hidden="true">
          <AnimatePresence mode="popLayout" initial={false}>
            {typing ? (
              <motion.span
                key="enter"
                {...hintMotion}
                className="flex size-7 items-center justify-center rounded-full bg-space text-zinc-950"
              >
                <CornerDownLeft size={14} strokeWidth={2} />
              </motion.span>
            ) : (
              <motion.span key="kbd" {...hintMotion} className="flex items-center gap-1">
                <Key>Ctrl</Key>
                <Key>K</Key>
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </label>
    </form>
  );
}
