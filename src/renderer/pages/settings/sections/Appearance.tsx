import { Blend, Layers2, Monitor, Moon, Square, Sun } from 'lucide-react';
import type { ThemeMode, WindowMaterial } from '@shared/types';
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
