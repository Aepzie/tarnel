import { useCallback, useEffect } from 'react';
import { LayoutGroup } from 'motion/react';
import type { UICommand } from '@shared/types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getBrowserStateSnapshot, useActiveSpace, useCommand, useSettings } from '@/hooks/browser';
import { resetOverlayOnBoot } from '@/hooks/overlay';
import { addressSeed, applyTheme, settle } from '@/lib/vela';
import { cn } from '@/lib/utils';
import { ui } from './ui-store';
import { Viewport } from './Viewport';
import { WindowTint } from './WindowTint';
import { TopIsland } from './island/TopIsland';
import { FindBar } from './find/FindBar';
import { CommandPalette } from './palette/CommandPalette';
import { PermissionPrompt } from './permissions/PermissionPrompt';
import { VerticalIsland } from './vertical/VerticalIsland';
import { TaskManager } from './task-manager/TaskManager';

/**
 * Browser chrome root. Layout: floating top island, optional find strip, page viewport; in the
 * vertical tab layout a floating tab island sits to their left.
 * Everything else (palette, menus, toasts) renders in portals and raises the overlay while open.
 */
export function App() {
  const settings = useSettings();
  const space = useActiveSpace();

  useEffect(() => resetOverlayOnBoot(), []);

  useEffect(() => {
    document.documentElement.dataset.material = settings.windowMaterial;
  }, [settings.windowMaterial]);

  useEffect(() => {
    applyTheme(settings.theme, space?.color);
  }, [settings.theme, space?.color]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => applyTheme(settings.theme, space?.color);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [settings.theme, space?.color]);

  const onCommand = useCallback(
    (command: UICommand) => {
      switch (command) {
        case 'command-palette':
          ui.openPalette('current');
          break;
        case 'focus-address':
        {
          const { tabs, activeTabId } = getBrowserStateSnapshot();
          ui.openPalette('current', addressSeed(tabs.find((tab) => tab.id === activeTabId)?.url));
        }
          break;
        case 'find':
          ui.openFind();
          break;
        case 'toggle-sidebar':
          settle(window.vela.settings.set({ autoHideToolbar: !settings.autoHideToolbar }));
          break;
        case 'escape':
          if (ui.get().palette.open) ui.closePalette();
          else if (ui.get().find.open) ui.closeFind();
          break;
        case 'new-space':
          break;
      }
    },
    [settings.autoHideToolbar],
  );
  useCommand(onCommand);

  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={150}>
      <LayoutGroup>
        <div className="flex h-screen w-screen gap-2 overflow-hidden p-2 select-none">
          {/* A fully transparent window ('none') must show the desktop untinted around the islands. */}
          <WindowTint className={cn(settings.windowMaterial !== 'none' && 'light:bg-[color-mix(in_oklab,var(--window)_90%,transparent)]')} />
          {settings.tabLayout === 'vertical' && <VerticalIsland />}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <TopIsland />
            <FindBar />
            <Viewport />
          </div>
        </div>
        <PermissionPrompt />
        <CommandPalette />
        <TaskManager />
      </LayoutGroup>
    </TooltipProvider>
  );
}
