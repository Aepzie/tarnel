import { Languages } from 'lucide-react';
import { useActiveTab } from '@/hooks/browser';
import { cn } from '@/lib/utils';
import { languageName } from '@shared/translate';
import { toggleTranslation, useTranslateState } from './translate-store';

/** Translate offer next to the palette's site chip: shown when the page language differs from the target language. */
export function TranslateButton() {
  const tab = useActiveTab();
  const state = useTranslateState(tab && /^https?:|^file:/.test(tab.url) ? tab.id : null);
  if (!tab || !state) return null;
  const busy = state.phase === 'downloading' || state.phase === 'translating';
  const translated = state.phase === 'translated';
  if (!busy && !translated && !state.available) return null;
  const from = state.pageLang ? languageName(state.pageLang) : 'page';
  const to = languageName(state.targetLang);
  const title = translated
    ? `Show original (${from})`
    : busy
      ? `${state.phase === 'downloading' ? 'Downloading model' : 'Translating'} · ${Math.round(state.progress * 100)}% · click to cancel`
      : state.phase === 'error' && state.error
        ? `${state.error} · try again`
        : `Translate ${from} → ${to} on this device`;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={translated}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => toggleTranslation(tab.id)}
      className={cn(
        'no-drag inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-1.5 text-muted-foreground outline-none transition-colors duration-150 hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:scale-[0.96] light:hover:bg-black/[0.05]',
        (translated || busy) && 'text-space hover:text-space',
      )}
    >
      <Languages className="size-3.5" strokeWidth={1.75} />
      {busy && <span className="text-[10.5px] tabular-nums">{Math.round(state.progress * 100)}%</span>}
    </button>
  );
}
