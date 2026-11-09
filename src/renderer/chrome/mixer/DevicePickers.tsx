import { ChevronsUpDownIcon, MicIcon, Volume2Icon } from 'lucide-react';
import type { MediaDeviceSlot, TabState } from '@shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MENU_ITEM, MENU_SURFACE } from '../tabs/menu-style';
import { DEFAULT_KEY, SLOT_TITLES, slotValue, useDeviceSections, type DeviceSection } from '../audio/device-sections';
import { selectDevice } from '../audio/select-device';

const SLOTS: readonly MediaDeviceSlot[] = ['output', 'input'];
const ICONS = { output: Volume2Icon, input: MicIcon, camera: Volume2Icon } as const;
const RADIO = cn(MENU_ITEM, 'pl-8 [&>span:first-child]:left-2.5 [&>span:first-child]:text-space [&>span:first-child_svg]:size-1.5');
const DETAIL = 'ml-auto min-w-0 shrink truncate pl-3 text-[11.5px] text-zinc-500';

function currentLabel(tab: TabState, section: DeviceSection): { name: string; warn: boolean } {
  const value = slotValue(tab, section.slot);
  if (value === DEFAULT_KEY) return { name: section.defaultName ? `Default · ${section.defaultName}` : 'System default', warn: false };
  if (section.missing) return { name: `${section.missing.name} (disconnected)`, warn: true };
  return { name: section.options.find((option) => option.key === value)?.name ?? 'System default', warn: false };
}

function DevicePicker({ tab, section }: { tab: TabState; section: DeviceSection }) {
  const Icon = ICONS[section.slot];
  const current = currentLabel(tab, section);
  const value = slotValue(tab, section.slot);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${SLOT_TITLES[section.slot]}: ${current.name}`}
          className={cn(
            'flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg bg-foreground/[0.035] px-2.5 text-left ring-1 ring-foreground/[0.06] outline-none ring-inset',
            'transition-[background-color] duration-150 hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-foreground/[0.07]',
          )}
        >
          <Icon className="size-[15px] shrink-0 text-zinc-400" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] leading-tight font-medium tracking-wide text-zinc-500 uppercase">{SLOT_TITLES[section.slot]}</span>
            <span className={cn('block truncate text-[12px] leading-tight tracking-tight', current.warn ? 'text-amber-300/90 light:text-amber-600' : 'text-foreground/90')}>
              {current.name}
            </span>
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-zinc-500" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} collisionPadding={8} className={cn(MENU_SURFACE, 'w-[var(--radix-dropdown-menu-trigger-width)] min-w-64')}>
        <DropdownMenuRadioGroup value={value} onValueChange={(key) => selectDevice(tab.id, section.slot, key, section.options)}>
          <DropdownMenuRadioItem value={DEFAULT_KEY} className={RADIO}>
            <span className="shrink-0">System default</span>
            {section.defaultName && <span className={DETAIL}>{section.defaultName}</span>}
          </DropdownMenuRadioItem>
          {section.missing && (
            <DropdownMenuRadioItem value={section.missing.key} className={RADIO} disabled>
              <span className="min-w-0 truncate">{section.missing.name}</span>
              <span className="ml-auto shrink-0 pl-3 text-[11.5px] text-amber-400/90 light:text-amber-600">Disconnected</span>
            </DropdownMenuRadioItem>
          )}
          {section.options.map((option) => (
            <DropdownMenuRadioItem key={option.key} value={option.key} className={RADIO} title={option.label}>
              <span className="max-w-[70%] shrink-0 truncate">{option.name}</span>
              {option.detail && <span className={DETAIL}>{option.detail}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Speaker + microphone of one tab, reusing the per-tab audio devices feature (chrome/audio). */
export function DevicePickers({ tab }: { tab: TabState }) {
  const sections = useDeviceSections(tab, true, SLOTS);
  return (
    <div className="flex gap-2">
      {sections.map((section) => (
        <DevicePicker key={section.slot} tab={tab} section={section} />
      ))}
    </div>
  );
}
