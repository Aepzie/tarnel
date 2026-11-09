import { AudioLinesIcon } from 'lucide-react';
import type { TabState } from '@shared/types';
import {
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { MENU_ITEM, MENU_SEPARATOR, MENU_SURFACE } from '../tabs/menu-style';
import { DEFAULT_KEY, SLOT_TITLES, slotValue, useDeviceSections, type DeviceSection } from './device-sections';
import { selectDevice } from './select-device';

const RADIO = cn(MENU_ITEM, 'pl-8 [&>span:first-child]:left-2.5 [&>span:first-child]:text-space [&>span:first-child_svg]:size-1.5');
const DETAIL = 'ml-auto min-w-0 shrink truncate pl-3 text-[11.5px] text-zinc-500';
const LABEL = 'px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase';

function Section({ tab, section, first }: { tab: TabState; section: DeviceSection; first: boolean }) {
  const { slot, options, defaultName, missing } = section;
  return (
    <>
      {!first && <ContextMenuSeparator className={MENU_SEPARATOR} />}
      <ContextMenuLabel className={LABEL}>{SLOT_TITLES[slot]}</ContextMenuLabel>
      <ContextMenuRadioGroup value={slotValue(tab, slot)} onValueChange={(key) => selectDevice(tab.id, slot, key, options)}>
        <ContextMenuRadioItem value={DEFAULT_KEY} className={RADIO}>
          <span className="shrink-0">System default</span>
          {defaultName && <span className={DETAIL}>{defaultName}</span>}
        </ContextMenuRadioItem>
        {missing && (
          <ContextMenuRadioItem value={missing.key} className={RADIO} disabled>
            <span className="min-w-0 truncate">{missing.name}</span>
            <span className="ml-auto shrink-0 pl-3 text-[11.5px] text-amber-400/90 light:text-amber-600">Disconnected</span>
          </ContextMenuRadioItem>
        )}
        {options.map((option) => (
          <ContextMenuRadioItem key={option.key} value={option.key} className={RADIO}>
            <span className="max-w-[70%] shrink-0 truncate" title={option.label}>{option.name}</span>
            {option.detail && <span className={DETAIL}>{option.detail}</span>}
          </ContextMenuRadioItem>
        ))}
      </ContextMenuRadioGroup>
    </>
  );
}

/** "Audio devices ›" in the tab context menu: output, microphone and camera for this tab only. */
export function AudioDevicesMenu({ tab }: { tab: TabState }) {
  const sections = useDeviceSections(tab, true);
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className={`${MENU_ITEM} [&>svg:last-child]:size-3.5`}>
        <AudioLinesIcon strokeWidth={1.75} />
        Audio devices
        {tab.devices && <span className="mr-1 ml-auto size-1.5 rounded-full bg-space" aria-label="Custom devices" />}
      </ContextMenuSubTrigger>
      <ContextMenuPortal>
        <ContextMenuSubContent className={`${MENU_SURFACE} max-h-[min(520px,var(--radix-context-menu-content-available-height))] w-80 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>
          {sections.map((section, index) => (
            <Section key={section.slot} tab={tab} section={section} first={index === 0} />
          ))}
        </ContextMenuSubContent>
      </ContextMenuPortal>
    </ContextMenuSub>
  );
}
