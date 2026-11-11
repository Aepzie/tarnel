import { Blend, CalendarDays, CircleDashed, Clock3, Layers2, Monitor, Moon, Sailboat, Square, Sun, Sunrise, Timer } from 'lucide-react';
import { PanelLeft, PanelTop } from 'lucide-react';
import type { NewtabHero, TabLayout, ThemeMode, WindowMaterial } from '@shared/types';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Segmented, type SegmentOption } from '../components/controls';
import { Group, Row, SectionHeader, SwitchRow } from '../components/layout';
import { useSettings } from '../store';

const THEMES: readonly SegmentOption<ThemeMode>[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
];

const MATERIALS: readonly SegmentOption<WindowMaterial>[] = [
  { value: 'mica', label: 'Mica', icon: Layers2 },
  { value: 'acrylic', label: 'Acrylic', icon: Blend },
  { value: 'none', label: 'None', icon: Square },
];

const TAB_LAYOUTS: readonly SegmentOption<TabLayout>[] = [
  { value: 'horizontal', label: 'Horizontal', icon: PanelTop },
  { value: 'vertical', label: 'Vertical', icon: PanelLeft },
];

const HEROES: readonly SegmentOption<NewtabHero>[] = [
  { value: 'clock', label: 'Clock', icon: Clock3 },
  { value: 'clock-seconds', label: 'Seconds', icon: Timer },
  { value: 'logo', label: 'Logo', icon: Sailboat },
  { value: 'date', label: 'Date', icon: CalendarDays },
  { value: 'greeting', label: 'Greeting', icon: Sunrise },
  { value: 'minimal', label: 'Minimal', icon: CircleDashed },
];

export function Appearance() {
  const { settings, update } = useSettings();
  return (
    <>
      <SectionHeader title="Appearance" description="How Vela looks and gets out of your way." />
      <Group>
        <Row title="Theme" description="Follow the system, or pin light or dark.">
          <Segmented label="Theme" value={settings.theme} options={THEMES} onChange={(theme) => update({ theme })} />
        </Row>
        <Row
          title="Window material"
          description={
            <span className="inline-flex flex-wrap items-center gap-x-1.5">
              The backdrop behind the floating islands.
              <span className="rounded-full px-1.5 text-[11px] leading-4 font-medium text-muted-foreground ring-1 ring-border">
                Windows 11 only
              </span>
            </span>
          }
        >
          <Segmented
            label="Window material"
            value={settings.windowMaterial}
            options={MATERIALS}
            onChange={(windowMaterial) => update({ windowMaterial })}
          />
        </Row>
        <Row
          title="Tab layout"
          description={
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
              Tabs in the top island, or in a floating island on the left
              <span aria-hidden>·</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>Shift</Kbd>
                <Kbd>,</Kbd>
              </KbdGroup>
            </span>
          }
        >
          <Segmented label="Tab layout" value={settings.tabLayout} options={TAB_LAYOUTS} onChange={(tabLayout) => update({ tabLayout })} />
        </Row>
        <Row title="Start page" description="What sits above the search bar. Click it on a new tab to cycle.">
          <Segmented
            label="Start page style"
            compact
            value={settings.newtabHero}
            options={HEROES}
            onChange={(newtabHero) => update({ newtabHero })}
          />
        </Row>
      </Group>
      <Group title="Start page">
        <SwitchRow
          title="Privacy stat"
          description="A small line with this week’s blocked trackers, linking to your privacy report."
          setting="newtabPrivacyStat"
        />
      </Group>
      <Group title="Bookmarks">
        <SwitchRow
          title="Show bookmarks bar"
          setting="showBookmarksBar"
          description={
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
              A slim row of bookmarks under the toolbar
              <span aria-hidden>·</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>Shift</Kbd>
                <Kbd>B</Kbd>
              </KbdGroup>
            </span>
          }
        />
      </Group>
      <Group title="Focus">
        <SwitchRow
          title="Focus mode"
          setting="autoHideToolbar"
          description={
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
              Hide the toolbar; reveal it by moving to the top edge
              <span aria-hidden>·</span>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>Shift</Kbd>
                <Kbd>S</Kbd>
              </KbdGroup>
            </span>
          }
        />
      </Group>
    </>
  );
}
