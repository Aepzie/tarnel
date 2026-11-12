import { useId } from 'react';
import type { SearchEngine } from '@shared/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DefaultBrowserRow } from '../components/default-browser';
import { Group, Row, SectionHeader, SwitchRow } from '../components/layout';
import { useSettings } from '../store';
import { Languages } from './Languages';

const ENGINES: readonly { value: SearchEngine; label: string }[] = [
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'google', label: 'Google' },
  { value: 'brave', label: 'Brave Search' },
  { value: 'startpage', label: 'Startpage' },
  { value: 'ecosia', label: 'Ecosia' },
];

export function General() {
  const { settings, update } = useSettings();
  const engineId = useId();
  return (
    <>
      <SectionHeader title="General" description="Search and startup behavior." />
      <Group>
        <DefaultBrowserRow />
        <Row
          title="Search engine"
          description="Used for searches from the address bar and new tab."
          htmlFor={engineId}
        >
          <Select value={settings.searchEngine} onValueChange={(value) => update({ searchEngine: value as SearchEngine })}>
            <SelectTrigger id={engineId} size="sm" className="h-8 w-40 rounded-lg text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end" sideOffset={6} className="rounded-xl p-0.5 backdrop-blur-xl">
              {ENGINES.map((engine) => (
                <SelectItem key={engine.value} value={engine.value} className="rounded-lg text-xs">
                  {engine.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <SwitchRow
          title="Restore previous session"
          description="Reopen your tabs and Spaces when Tarnel starts."
          setting="restoreSession"
        />
        <SwitchRow
          title="Shift-click opens Peek"
          description="Preview links in a floating window over the page instead of a new window."
          setting="peekOnShiftClick"
        />
      </Group>
      <Languages />
    </>
  );
}
