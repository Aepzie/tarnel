import type { LucideIcon } from 'lucide-react';
import { EyeOff, Flame, Focus, History, Monitor, Moon, Plus, Puzzle, RotateCcw, Settings2, ShieldCheck, Sun } from 'lucide-react';
import { ChevronsDownUp, ChevronsUpDown, LayersPlus, PanelLeft, PanelTop } from 'lucide-react';
import { Bookmark, BookmarkCheck, Star } from 'lucide-react';
import { ui } from '../ui-store';
import type { BrowserState, Settings, ThemeMode } from '@shared/types';
import { groupActiveTab } from '../tabs/groups/group-ui';
import { splitCommands } from '../split/split-commands';
import { audioCommands } from '../audio/audio-commands';
import { mixerCommands } from '../mixer/mixer-commands';
import { vpnCommands } from '../vpn/vpn-commands';
import { taskManagerCommands } from '../task-manager/task-manager-commands';
import { archiveCommands } from '../archive/archive-commands';

export interface PaletteCommand {
  id: string;
  title: string;
  icon: LucideIcon;
  keywords: string;
  /** Right-side status hint, e.g. "On" / "Off" / current theme. */
  hint?: string;
  active?: boolean;
  run: () => void;
}

interface CommandContext {
  settings: Settings;
  state: BrowserState;
}

const THEMES: { mode: ThemeMode; label: string; icon: LucideIcon }[] = [
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'system', label: 'System', icon: Monitor },
];

export function buildCommands({ settings, state }: CommandContext): PaletteCommand[] {
  const vela = window.vela;
  const activeTabId = state.activeTabId;
  const commands: PaletteCommand[] = [
    {
      id: 'cmd:new-tab',
      title: 'New tab',
      icon: Plus,
      keywords: 'open create blank',
      run: () => void vela.tabs.create({}),
    },
    {
      id: 'cmd:burner',
      title: 'New Burner space',
      icon: Flame,
      keywords: 'ephemeral private incognito temporary space',
      run: () =>
        void vela.spaces
          .create({ name: 'Burner', color: 'orange', ephemeral: true })
          .then((space) => vela.spaces.activate(space.id)),
    },
    {
      id: 'cmd:panic',
      title: 'Panic: wipe Burners and lock',
      icon: EyeOff,
      keywords: 'panic boss key hide minimize mute wipe burner close vpn disconnect emergency',
      hint: 'Ctrl Shift Del',
      run: () => void vela.panic(),
    },
    {
      id: 'cmd:adblock',
      title: 'Toggle adblock',
      icon: ShieldCheck,
      keywords: 'ads blocker content tracker privacy',
      hint: settings.adblock ? 'On' : 'Off',
      active: settings.adblock,
      run: () => void vela.settings.set({ adblock: !settings.adblock }),
    },
    {
      id: 'cmd:bookmarks',
      title: 'Bookmarks',
      icon: Bookmark,
      keywords: 'favorites saved pages manager organize star',
      run: () => void vela.bookmarks.openManager(),
    },
    {
      id: 'cmd:bookmark-page',
      title: 'Bookmark this page',
      icon: Star,
      keywords: 'add favorite save star',
      hint: 'Ctrl D',
      run: () => ui.openBookmarkEditor(),
    },
    {
      id: 'cmd:bookmarks-bar',
      title: 'Toggle bookmarks bar',
      icon: BookmarkCheck,
      keywords: 'favorites bar toolbar show hide',
      hint: settings.showBookmarksBar ? 'On' : 'Off',
      active: settings.showBookmarksBar,
      run: () => void vela.settings.set({ showBookmarksBar: !settings.showBookmarksBar }),
    },
    {
      id: 'cmd:focus',
      title: 'Toggle focus mode',
      icon: Focus,
      keywords: 'zen hide toolbar island distraction',
      hint: settings.autoHideToolbar ? 'On' : 'Off',
      active: settings.autoHideToolbar,
      run: () => void vela.settings.set({ autoHideToolbar: !settings.autoHideToolbar }),
    },
    ...THEMES.map(
      ({ mode, label, icon }): PaletteCommand => ({
        id: `cmd:theme-${mode}`,
        title: `Theme: ${label}`,
        icon,
        keywords: 'appearance color scheme mode',
        hint: settings.theme === mode ? 'Current' : undefined,
        active: settings.theme === mode,
        run: () => void vela.settings.set({ theme: mode }),
      }),
    ),
    {
      id: 'cmd:history',
      title: 'History',
      icon: History,
      keywords: 'visited recent pages past browsing',
      hint: 'Ctrl H',
      run: () => void vela.tabs.create({ url: 'vela://history' }),
    },
    {
      id: 'cmd:extensions-store',
      title: 'Extensions store',
      icon: Puzzle,
      keywords: 'extensions add-ons plugins marketplace install chrome web store',
      run: () => void vela.tabs.create({ url: 'vela://extensions/' }),
    },
    {
      id: 'cmd:settings',
      title: 'Settings',
      icon: Settings2,
      keywords: 'preferences options config',
      run: () => void vela.tabs.create({ url: 'vela://settings' }),
    },
  ];
  commands.push(...tabGroupCommands({ settings, state }));
  commands.push(...splitCommands(state));
  commands.push(...mixerCommands());
  commands.push(...vpnCommands());
  commands.push(...taskManagerCommands());
  commands.push(...archiveCommands(activeTabId));
  commands.push(...audioCommands(state));
  if (activeTabId !== null) {
    commands.push({
      id: 'cmd:zoom-reset',
      title: 'Zoom reset',
      icon: RotateCcw,
      keywords: 'actual size 100% zoom',
      run: () => void vela.tabs.zoom(activeTabId, 0),
    });
  }
  return commands;
}

/** Tab layout and tab group commands. */
function tabGroupCommands({ settings, state }: CommandContext): PaletteCommand[] {
  const vela = window.vela;
  const vertical = settings.tabLayout === 'vertical';
  const groups = state.groups.filter((group) => group.spaceId === state.activeSpaceId);
  const commands: PaletteCommand[] = [
    {
      id: 'cmd:tab-layout',
      title: vertical ? 'Tab layout: Horizontal' : 'Tab layout: Vertical',
      icon: vertical ? PanelTop : PanelLeft,
      keywords: 'vertical horizontal sidebar tabs strip layout toggle',
      hint: vertical ? 'Vertical' : 'Horizontal',
      run: () => void vela.settings.set({ tabLayout: vertical ? 'horizontal' : 'vertical' }),
    },
  ];
  if (state.activeTabId !== null) {
    commands.push({
      id: 'cmd:new-group',
      title: 'New tab group',
      icon: LayersPlus,
      keywords: 'group tabs add create organize',
      run: () => groupActiveTab(state.tabs, state.activeTabId),
    });
  }
  if (groups.length > 0) {
    const allCollapsed = groups.every((group) => group.collapsed);
    commands.push({
      id: 'cmd:collapse-groups',
      title: allCollapsed ? 'Expand all groups' : 'Collapse all groups',
      icon: allCollapsed ? ChevronsUpDown : ChevronsDownUp,
      keywords: 'tab groups fold unfold collapse expand',
      run: () => void vela.groups.setAllCollapsed(!allCollapsed),
    });
  }
  return commands;
}

/**
 * Small fuzzy scorer: contiguous / word-start matches score highest, in-order subsequence matches
 * score low, anything else is -1.
 */
export function scoreCommand(command: PaletteCommand, rawQuery: string): number {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 1;
  const title = command.title.toLowerCase();
  if (title.startsWith(query)) return 100 - title.length * 0.1;
  const words = title.split(/[\s:]+/);
  if (words.some((word) => word.startsWith(query))) return 80;
  if (title.includes(query)) return 60;
  if (command.keywords.split(' ').some((word) => word.startsWith(query))) return 40;
  let cursor = 0;
  for (const char of title) {
    if (char === query[cursor]) cursor += 1;
    if (cursor === query.length) return 10;
  }
  return -1;
}

export function rankCommands(commands: PaletteCommand[], query: string, minScore: number): PaletteCommand[] {
  return commands
    .map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .map(({ command }) => command);
}
