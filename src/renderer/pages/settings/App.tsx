import { useCallback, useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { Cloud, Gauge, Import as ImportIcon, Info, Layers, Palette, Puzzle, Settings2, Shield, Workflow, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ease, spring, stagger } from '@/lib/motion';
import { VelaMark } from './components/brand';
import { SettingsProvider } from './store';
import { About } from './sections/About';
import { Appearance } from './sections/Appearance';
import { Extensions } from './sections/Extensions';
import { General } from './sections/General';
import { Import } from './sections/Import';
import { Performance } from './sections/Performance';
import { Privacy } from './sections/Privacy';
import { Rules } from './sections/Rules';
import { Spaces } from './sections/Spaces';
import { Sync } from './sections/Sync';

type SectionId = 'general' | 'appearance' | 'spaces' | 'rules' | 'extensions' | 'privacy' | 'sync' | 'import' | 'performance' | 'about';

interface SectionDef {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  Component: ComponentType;
}

const SECTIONS: readonly SectionDef[] = [
  { id: 'general', label: 'General', icon: Settings2, Component: General },
  { id: 'appearance', label: 'Appearance', icon: Palette, Component: Appearance },
  { id: 'spaces', label: 'Spaces', icon: Layers, Component: Spaces },
  { id: 'rules', label: 'Rules', icon: Workflow, Component: Rules },
  { id: 'extensions', label: 'Extensions', icon: Puzzle, Component: Extensions },
  { id: 'privacy', label: 'Privacy', icon: Shield, Component: Privacy },
  { id: 'sync', label: 'Sync', icon: Cloud, Component: Sync },
  { id: 'import', label: 'Import', icon: ImportIcon, Component: Import },
  { id: 'performance', label: 'Performance', icon: Gauge, Component: Performance },
  { id: 'about', label: 'About', icon: Info, Component: About },
];

function sectionFromHash(): SectionId {
  const id = location.hash.slice(1);
  return SECTIONS.find((section) => section.id === id)?.id ?? 'general';
}

function useHashSection(): [SectionId, (id: SectionId) => void] {
  const [section, setSection] = useState<SectionId>(sectionFromHash);

  useEffect(() => {
    const listeners = new AbortController();
    window.addEventListener('hashchange', () => setSection(sectionFromHash()), { signal: listeners.signal });
    return () => listeners.abort();
  }, []);

  useEffect(() => {
    const label = SECTIONS.find((entry) => entry.id === section)?.label ?? 'Settings';
    document.title = `${label} · Settings`;
  }, [section]);

  const go = useCallback((id: SectionId) => {
    setSection((current) => {
      if (current === id) return current;
      history.replaceState(null, '', `#${id}`);
      window.scrollTo({ top: 0 });
      return id;
    });
  }, []);

  return [section, go];
}

function Nav({ section, onSelect }: { section: SectionId; onSelect: (id: SectionId) => void }) {
  const items = useRef<(HTMLAnchorElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = items.current.findIndex((node) => node === document.activeElement);
    if (index < 0) return;
    const last = SECTIONS.length - 1;
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % SECTIONS.length
        : event.key === 'ArrowUp'
          ? (index + last) % SECTIONS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    items.current[next]?.focus();
  };

  return (
    <nav aria-label="Settings sections" onKeyDown={onKeyDown}>
      <ul className="flex flex-col gap-0.5">
        {SECTIONS.map(({ id, label, icon: Icon }, index) => {
          const active = id === section;
          return (
            <li key={id}>
              <a
                ref={(node) => {
                  items.current[index] = node;
                }}
                href={`#${id}`}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(id);
                }}
                className={cn(
                  'group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium outline-none select-none',
                  'transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60',
                  active ? 'text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="settings-nav-active"
                    data-slot="glass-control-highlight"
                    transition={spring.snappy}
                    aria-hidden
                    className="absolute inset-0 rounded-lg bg-accent ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]"
                  />
                )}
                <Icon
                  className={cn(
                    'relative size-[15px] shrink-0 transition-colors duration-150',
                    active ? 'text-space' : 'text-muted-foreground group-hover:text-foreground',
                  )}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="relative">{label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ContentSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading settings" className="motion-safe:animate-pulse">
      <div className="mb-2 h-8 w-40 rounded-md bg-muted" />
      <div className="mb-8 h-5 w-72 rounded-md bg-muted" />
      <div className="h-32 rounded-xl bg-muted/60 ring-1 ring-border" />
    </div>
  );
}

export function App() {
  const [section, setSection] = useHashSection();
  const reduce = useReducedMotion();
  const active = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0]!;
  const Active = active.Component;

  return (
    <MotionConfig reducedMotion="user">
      <div data-slot="settings-page" className="relative isolate min-h-screen bg-background text-foreground">
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-56 -left-48 size-[640px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent-space)_18%,transparent),transparent)] blur-2xl" />
          <div className="absolute -top-32 left-40 size-[420px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent-space)_9%,transparent),transparent)] blur-2xl" />
        </div>

        <div className="mx-auto flex w-full max-w-5xl gap-12 px-8">
          <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col py-10">
            <div className="mb-8 flex items-center gap-2.5 px-2.5">
              <span className="grid size-8 place-items-center rounded-[10px] bg-card ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]">
                <VelaMark className="size-[18px] text-foreground" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">Settings</span>
            </div>
            <Nav section={section} onSelect={setSection} />
          </aside>

          <main className="min-w-0 max-w-2xl flex-1 py-10" aria-label={active.label}>
            <SettingsProvider fallback={<ContentSkeleton />}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={section}
                  initial={{ opacity: 0, y: reduce ? 0 : 6, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.22, ease: ease.out } }}
                  exit={{ opacity: 0, y: reduce ? 0 : -4, filter: 'blur(2px)', transition: { duration: 0.1, ease: ease.out } }}
                >
                  <motion.div variants={stagger(0.04)} initial="hidden" animate="show">
                    <Active />
                  </motion.div>
                </motion.div>
              </AnimatePresence>
            </SettingsProvider>
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}
