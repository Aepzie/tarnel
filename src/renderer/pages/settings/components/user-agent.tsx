import { Shuffle } from 'lucide-react';
import { randomUserAgent, userAgentPresets } from '@shared/user-agent';
import { Button } from '@/components/ui/button';
import { RegionSelect } from '@/chrome/spaces/FingerprintPicker';

type Brands = { brands?: { brand: string; version: string }[] };

/** Vela's Chromium major, so the Chrome presets match what Sec-CH-UA reports. */
function chromeMajor(): number {
  const brands = (navigator as Navigator & { userAgentData?: Brands }).userAgentData?.brands;
  const version = brands?.find((entry) => entry.brand === 'Chromium')?.version ?? /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1];
  return Number(version) || 0;
}

const PRESETS = userAgentPresets(chromeMajor());

interface UserAgentPickerProps {
  label: string;
  value: string;
  /** Label of the '' entry ("Vela default" globally, "Use default" in a Space). */
  defaultLabel: string;
  onChange: (value: string) => void;
}

/** Preset list plus a randomize button; '' falls back to the next level. */
export function UserAgentPicker({ label, value, defaultLabel, onChange }: UserAgentPickerProps) {
  return (
    <div className="flex items-center gap-1">
      <RegionSelect label={label} value={value} options={[{ value: '', label: defaultLabel }, ...PRESETS]} onChange={onChange} className="w-44" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Random ${label.toLowerCase()}`}
        title="Randomize"
        onClick={() => onChange(randomUserAgent(PRESETS, value))}
        className="text-muted-foreground hover:text-foreground"
      >
        <Shuffle className="size-4" strokeWidth={1.75} aria-hidden />
      </Button>
    </div>
  );
}
