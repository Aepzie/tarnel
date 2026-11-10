import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { Command } from '@/components/ui/command';
import { Kbd } from '@/components/ui/kbd';
import { getBrowserStateSnapshot, useActiveSpace, useActiveTab, useBrowserSlice, useSettings } from '@/hooks/browser';
import { BlockedBadge, SecurityIcon, parseAddress } from '../tabs/TabItem';
import { useOverlay } from '@/hooks/overlay';
import { settle } from '@/lib/vela';
import { ease, spring } from '@/lib/motion';
import { SPACE_HEX } from '@/lib/vela';
import { ui, useChromeUI, type ChromeUIState } from '../ui-store';
import { buildCommands, rankCommands } from './commands';
import { classifyInput, preconnectTarget } from './input';
import { LeadingIcon } from './LeadingIcon';
import { SiteInfoTrigger } from '../site-info/SiteInfoPanel';
import { PaletteRow, type PaletteRowModel } from './PaletteRow';
import { useSuggestions } from './useSuggestions';

const MAX_STAGGER = 8;
const STAGGER_STEP = 0.022;
const PRECONNECT_THROTTLE_MS = 160;

/**
 * Raycast-style omnibox. The glass surface shares `layoutId="omnibox"` with the active tab pill so it
 * morphs out of the tab strip; content fades in on top. Holds the overlay until the exit animation
 * has finished so the page view never pops over a half-closed palette.
 */
export function CommandPalette() {
  const { palette } = useChromeUI();
  const [present, setPresent] = useState(false);
  if (palette.open && !present) setPresent(true);
  useOverlay(palette.open || present);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence onExitComplete={() => setPresent(false)}>
        {palette.open && <PaletteLayer key="palette" palette={palette} />}
      </AnimatePresence>
    </MotionConfig>
  );
}

interface Group {
  heading: string | null;
  rows: PaletteRowModel[];
}

function PaletteLayer({ palette }: { palette: ChromeUIState['palette'] }) {
  const reduce = useReducedMotion();
  const settings = useSettings();
  const activeTabId = useBrowserSlice((s) => s.activeTabId);
  const faviconKey = useBrowserSlice((s) => s.tabs.map((tab) => `${tab.id} ${tab.favicon ?? ''}`).join('|'));
  const faviconsById = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const tab of getBrowserStateSnapshot().tabs) map.set(tab.id, tab.favicon);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faviconKey]);
  const space = useActiveSpace();
  const inputRef = useRef<HTMLInputElement>(null);
  const forceNewTab = useRef(false);
  const navigated = useRef(false);
  const [query, setQuery] = useState(palette.initial);
  const [selected, setSelected] = useState('');

  useLayoutEffect(() => {
    setQuery(palette.initial);
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [palette]);

  const kind = classifyInput(query);
  const commandText = kind === 'command' ? query.trimStart().slice(1) : query;
  const suggestions = useSuggestions(query, kind !== 'command');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(() => buildCommands({ settings, state: getBrowserStateSnapshot() }), [settings, activeTabId]);

  const groups = useMemo<Group[]>(() => {
    if (kind === 'command') {
      return [{ heading: 'Commands', rows: rankCommands(commands, commandText, 0).map(toCommandRow) }];
    }
    const text = query.trim();
    if (!text) {
      return [{ heading: 'Commands', rows: commands.slice(0, 6).map(toCommandRow) }];
    }
    const server = suggestions.query === text ? suggestions.items : [];
    const resolved = server.find((s) => s.kind === 'url' || s.kind === 'search')?.url ?? null;
    const go: PaletteRowModel = {
      type: 'go',
      id: 'go',
      input: text,
      kind: kind === 'url' ? 'url' : 'search',
      resolved,
    };
    const tabRows: PaletteRowModel[] = server
      .filter((s) => s.kind === 'tab' && s.tabId !== undefined && s.tabId !== activeTabId)
      .map((s) => ({
        type: 'tab',
        id: `tab:${s.tabId}`,
        tabId: s.tabId!,
        title: s.title,
        url: s.url,
        favicon: faviconsById.get(s.tabId!) ?? null,
      }));
    const historyRows: PaletteRowModel[] = server
      .filter((s) => s.kind === 'history')
      .map((s) => ({ type: 'history', id: `history:${s.url}`, title: s.title, url: s.url }));
    const remoteRows: PaletteRowModel[] = server
      .filter((s) => s.kind === 'remote-tab')
      .map((s) => ({ type: 'history', id: `remote:${s.device ?? ''}:${s.url}`, title: s.title, url: s.url, device: s.device }));
    const commandRows = text.length >= 2 ? rankCommands(commands, text, 40).slice(0, 3).map(toCommandRow) : [];
    return [
      { heading: null, rows: [go] },
      { heading: 'Open tabs', rows: tabRows },
      { heading: 'Commands', rows: commandRows },
      { heading: 'History', rows: historyRows },
      { heading: 'Other devices', rows: remoteRows },
    ].filter((group) => group.rows.length > 0);
  }, [kind, commands, commandText, query, suggestions, faviconsById, activeTabId]);

  const flatRows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const firstId = flatRows[0]?.id ?? '';
  const rowIds = flatRows.map((row) => row.id).join('|');

  useEffect(() => {
    setSelected((current) => (current && rowIds.split('|').includes(current) ? current : firstId));
  }, [rowIds, firstId]);

  const seenIds = useRef<Set<string>>(new Set());
  const mountedAt = useRef(performance.now());
  const entranceDelays = useMemo(() => {
    const delays = new Map<string, number | null>();
    const initialWave = performance.now() - mountedAt.current < 400;
    let staggerIndex = 0;
    for (const row of flatRows) {
      if (reduce || seenIds.current.has(row.id)) {
        delays.set(row.id, null);
        continue;
      }
      delays.set(row.id, initialWave ? Math.min(staggerIndex, MAX_STAGGER) * STAGGER_STEP + 0.05 : 0);
      staggerIndex += 1;
    }
    return delays;
  }, [flatRows, reduce]);
  useEffect(() => {
    flatRows.forEach((row) => seenIds.current.add(row.id));
  }, [flatRows]);

  const lastPreconnect = useRef({ url: '', at: 0 });
  useEffect(() => {
    const row = flatRows.find((candidate) => candidate.id === selected);
    if (!row) return;
    const target =
      row.type === 'go' ? (row.kind === 'url' ? (row.resolved ?? preconnectTarget(row.input)) : null)
      : row.type === 'tab' || row.type === 'history' ? row.url
      : null;
    if (!target || !/^https?:/i.test(target)) return;
    let origin: string;
    try {
      origin = new URL(target).origin;
    } catch {
      return;
    }
    const now = performance.now();
    const last = lastPreconnect.current;
    if (origin === last.url) return;
    const fire = (): void => {
      lastPreconnect.current = { url: origin, at: performance.now() };
      settle(window.vela.preconnect(target));
    };
    const wait = PRECONNECT_THROTTLE_MS - (now - last.at);
    if (wait <= 0) {
      fire();
      return;
    }
    const timer = window.setTimeout(fire, wait);
    return () => window.clearTimeout(timer);
  }, [selected, flatRows]);

  const flatRowsRef = useRef(flatRows);
  flatRowsRef.current = flatRows;

  const run = useCallback(
    (picked: PaletteRowModel) => {
      const row = flatRowsRef.current.find((candidate) => candidate.id === picked.id) ?? picked;
      const newTab = forceNewTab.current;
      forceNewTab.current = false;
      ui.closePalette();
      const vela = window.vela;
      const { activeTabId } = getBrowserStateSnapshot();
      const open = (input: string): void => {
        if (newTab || palette.mode === 'new-tab' || activeTabId === null) settle(vela.tabs.create({ url: input }));
        else settle(vela.tabs.navigate(activeTabId, input));
      };
      switch (row.type) {
        case 'go':
          open(row.input);
          break;
        case 'history':
          open(row.url);
          break;
        case 'tab':
          settle(vela.tabs.activate(row.tabId));
          break;
        case 'command':
          row.command.run();
          break;
      }
    },
    [palette.mode],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      ui.closePalette();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      navigated.current = true;
      return;
    }
    if (event.key !== 'Enter') return;
    if (!query.trim() && !navigated.current) {
      event.preventDefault();
      return;
    }
    forceNewTab.current = event.ctrlKey || event.metaKey;
  };

  const onListPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    forceNewTab.current = event.ctrlKey || event.metaKey || event.button === 1;
  };

  const onAuxClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 1) return;
    const item = (event.target as HTMLElement).closest<HTMLElement>('[cmdk-item]');
    const row = flatRows.find((candidate) => candidate.id === item?.dataset.value);
    if (!row) return;
    forceNewTab.current = true;
    run(row);
  };

  const listRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState<number | 'auto'>('auto');
  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setListHeight(node.offsetHeight));
    observer.observe(node);
    setListHeight(node.offsetHeight);
    return () => observer.disconnect();
  }, []);

  const contentEnter = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: -6, filter: 'blur(6px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
        exit: { opacity: 0, y: -4, filter: 'blur(4px)' },
      };

  return (
    <div className="fixed inset-0 z-[100]" role="presentation">
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm light:bg-zinc-900/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2, ease: ease.out } }}
        exit={{ opacity: 0, transition: { duration: 0.16, ease: ease.out } }}
        onPointerDown={() => ui.closePalette()}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="pointer-events-none absolute inset-x-0 top-[10vh] flex justify-center">
        <div
          className="pointer-events-auto relative w-[min(680px,92vw)]"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <motion.div
            layoutId="omnibox"
            layoutDependency={0}
            className="absolute inset-0 bg-popover shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_24px_80px_-12px_rgb(0_0_0/0.55),0_0_0_1px_color-mix(in_oklab,var(--accent-space)_10%,transparent)]"
            style={{ borderRadius: 16 }}
            transition={spring.soft}
          />
          <motion.div
            className="relative"
            {...contentEnter}
            transition={{ duration: 0.22, ease: ease.out, delay: reduce ? 0 : 0.04 }}
          >
            <Command
              shouldFilter={false}
              loop
              value={selected}
              onValueChange={setSelected}
              onKeyDown={onKeyDown}
              label="Command palette"
              className="rounded-2xl bg-transparent text-foreground"
            >
              <div className="flex h-[52px] items-center gap-3 px-4">
                <LeadingIcon kind={kind} />
                <CommandPrimitive.Input
                  ref={inputRef}
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search or enter address"
                  spellCheck={false}
                  autoComplete="off"
                  className="h-full min-w-0 flex-1 bg-transparent text-[15px] tracking-tight text-foreground outline-none placeholder:text-muted-foreground/70"
                />
                {palette.mode === 'current' && kind !== 'command' && <SiteInfo />}
                {kind === 'command' && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={spring.pop}
                    className="rounded-full bg-space/15 px-2 py-0.5 text-[11px] font-medium text-space"
                  >
                    Commands
                  </motion.span>
                )}
              </div>
              <div className="mx-3 h-px bg-border" />
              <motion.div
                className="overflow-hidden"
                initial={false}
                animate={{ height: listHeight }}
                transition={reduce ? { duration: 0 } : spring.snappy}
              >
                <motion.div
                  ref={listRef}
                  layoutScroll
                  className="max-h-[min(440px,56vh)] scroll-py-2 overflow-x-hidden overflow-y-auto overscroll-contain"
                >
                  <CommandPrimitive.List
                    className="px-2 py-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground/80"
                    onPointerDown={onListPointerDown}
                    onAuxClick={onAuxClick}
                  >
                    {flatRows.length === 0 && (
                      <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">No matching commands</div>
                    )}
                    {groups.map((group) => (
                      <CommandPrimitive.Group key={group.heading ?? 'top'} heading={group.heading ?? undefined}>
                        {group.rows.map((row) => (
                          <PaletteRow
                            key={row.id}
                            row={row}
                            selected={row.id === selected}
                            delay={entranceDelays.get(row.id) ?? null}
                            onRun={run}
                          />
                        ))}
                      </CommandPrimitive.Group>
                    ))}
                  </CommandPrimitive.List>
                </motion.div>
              </motion.div>
              <PaletteFooter spaceName={space?.name} spaceColor={space ? SPACE_HEX[space.color] : undefined} ephemeral={space?.ephemeral} />
            </Command>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/** Security state, host and blocked-request count of the page the palette edits. */
function SiteInfo() {
  const tab = useActiveTab();
  const reduce = !!useReducedMotion();
  if (!tab) return null;
  const address = parseAddress(tab);
  if (address.empty) return null;
  const security = address.internal ? 'Vela page' : tab.secure ? 'Secure connection' : tab.url.startsWith('http:') ? 'Not secure' : address.host;
  return (
    <SiteInfoTrigger tabId={tab.id} title={address.internal ? security : `${security} · Site information`}>
      <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-white/[0.05] px-2 text-[11.5px] text-muted-foreground ring-1 ring-white/[0.06] transition-colors duration-150 hover:bg-white/[0.09] light:bg-black/[0.035] light:ring-black/[0.06] light:hover:bg-black/[0.06]">
        <SecurityIcon tab={tab} address={address} />
        <span className="max-w-[160px] truncate">{address.host}</span>
      </span>
      <BlockedBadge count={tab.blockedCount} reduced={reduce} />
    </SiteInfoTrigger>
  );
}

function toCommandRow(command: ReturnType<typeof buildCommands>[number]): PaletteRowModel {
  return { type: 'command', id: command.id, command };
}

const footKbd = 'h-[18px] min-w-[18px] rounded-[4px] bg-secondary px-1 text-[10px] text-muted-foreground ring-1 ring-border';

function PaletteFooter({ spaceName, spaceColor, ephemeral }: { spaceName?: string; spaceColor?: string; ephemeral?: boolean }) {
  const hints: [string, string][] = [
    ['↑↓', 'navigate'],
    ['↵', 'open'],
    ['Ctrl ↵', 'new tab'],
    ['esc', 'close'],
  ];
  return (
    <div className="flex h-9 items-center gap-3 border-t border-border/70 px-3.5 text-[11px] text-muted-foreground/80">
      {hints.map(([key, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <Kbd className={footKbd}>{key}</Kbd>
          {label}
        </span>
      ))}
      {spaceName && (
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-secondary py-0.5 pr-2 pl-1.5 ring-1 ring-border">
          <span
            className="size-1.5 rounded-full"
            style={{ background: spaceColor, boxShadow: `0 0 6px ${spaceColor}` }}
          />
          <span className="max-w-32 truncate text-foreground/80">{spaceName}</span>
          {ephemeral && <span className="text-muted-foreground/70">· burner</span>}
        </span>
      )}
    </div>
  );
}
