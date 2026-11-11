import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Fingerprint, Loader2, RefreshCw } from 'lucide-react';
import { FINGERPRINT_LEVELS, type FingerprintLevel, type SpaceId } from '@shared/types';
import { LANGUAGE_CHOICES, TIMEZONE_CHOICES } from '@shared/fingerprint';
import { vela } from '@/lib/vela';
import { ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const LABELS: Record<FingerprintLevel, string> = { off: 'Off', standard: 'Standard', strict: 'Strict' };

const FINGERPRINT_HINTS: Record<FingerprintLevel, string> = {
  off: 'Sites see this device’s real fingerprint.',
  standard: 'Canvas, WebGL and audio get subtle per-site noise; hardware is generalized.',
  strict: 'Also masks screen size, media devices and client hints. May break a few sites.',
};

interface FingerprintPickerProps {
  value: FingerprintLevel;
  onChange: (level: FingerprintLevel) => void;
  /** Accent (Space color hex) for the selection pill. */
  hex: string;
  /** When set, offers "New fingerprint" for this existing Space. */
  spaceId?: SpaceId;
}

/** Off / Standard / Strict segmented control with a gliding accent pill. */
export function FingerprintPicker({ value, onChange, hex, spaceId }: FingerprintPickerProps) {
  const pillId = useId();
  const labelId = useId();
  const reduce = useReducedMotion();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (FINGERPRINT_LEVELS.indexOf(value) + step + FINGERPRINT_LEVELS.length) % FINGERPRINT_LEVELS.length;
    onChange(FINGERPRINT_LEVELS[index]!);
    refs.current[index]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <Fingerprint className="size-3.5" strokeWidth={1.75} aria-hidden />
          Fingerprint protection
        </span>
        {spaceId && value !== 'off' && <RegenerateButton spaceId={spaceId} />}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="grid grid-cols-3 gap-0.5 rounded-[10px] bg-muted p-0.5 ring-1 ring-border ring-inset"
      >
        {FINGERPRINT_LEVELS.map((level, index) => {
          const selected = level === value;
          return (
            <button
              key={level}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(level)}
              className={cn(
                'relative h-7 rounded-lg text-[12px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {selected && (
                <motion.span
                  layoutId={pillId}
                  aria-hidden
                  transition={reduce ? { duration: 0 } : spring.snappy}
                  className="absolute inset-0 rounded-lg bg-background dark:bg-white/[0.09]"
                  style={{ boxShadow: `inset 0 0 0 1px ${hex}40, 0 1px 2px rgb(0 0 0 / 0.08)` }}
                />
              )}
              <span className="relative z-10">{LABELS[level]}</span>
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={value}
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.16, ease: ease.out }}
          className="text-[11px] leading-4 text-muted-foreground"
        >
          {FINGERPRINT_HINTS[value]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function RegenerateButton({ spaceId }: { spaceId: SpaceId }) {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = window.setTimeout(() => setPhase('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const regenerate = async (): Promise<void> => {
    if (phase === 'busy') return;
    setPhase('busy');
    try {
      await vela().spaces.regenerateFingerprint(spaceId);
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  };

  const Icon = phase === 'busy' ? Loader2 : phase === 'done' ? Check : RefreshCw;
  return (
    <button
      type="button"
      onClick={() => void regenerate()}
      title="Every site sees a new fingerprint after its next load"
      className="-mr-1 flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]"
    >
      <Icon className={cn('size-3', phase === 'busy' && 'animate-spin')} strokeWidth={2} aria-hidden />
      {phase === 'done' ? 'Regenerated' : 'New fingerprint'}
    </button>
  );
}

/** Timezone select options: automatic, system, VPN country, then fixed zones. */
export const TIMEZONE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Automatic' },
  { value: 'system', label: 'System' },
  { value: 'vpn', label: 'Match VPN country' },
  ...TIMEZONE_CHOICES,
];

export const LANGUAGE_OPTIONS: readonly { value: string; label: string }[] = [{ value: '', label: 'System' }, ...LANGUAGE_CHOICES];

export const TIMEZONE_HINT = 'Automatic: UTC in Strict (the VPN country’s zone for routed tabs), the system zone otherwise.';

interface RegionSelectProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Radix can't use '' as an item value; '' (system / default) maps to this. */
const EMPTY = '__vela-empty__';

/** Quiet select for the timezone / language / user agent rows (themed popup, unlike a native <select>). */
export function RegionSelect({ label, value, options, onChange, disabled, className }: RegionSelectProps) {
  const known = options.some((option) => option.value === value);
  return (
    <Select value={value || EMPTY} onValueChange={(next) => onChange(next === EMPTY ? '' : next)} disabled={disabled}>
      <SelectTrigger aria-label={label} size="sm" className={cn('h-8 rounded-lg text-[12px] [&>span]:truncate', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end" sideOffset={6} className="z-[120] max-h-72 rounded-xl p-0.5 backdrop-blur-xl">
        {!known && value && (
          <SelectItem value={value} className="rounded-lg text-[12px]">
            {value}
          </SelectItem>
        )}
        {options.map((option) => (
          <SelectItem key={option.value || EMPTY} value={option.value || EMPTY} className="rounded-lg text-[12px]">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface RegionFieldsProps {
  timezone: string;
  language: string;
  onTimezone: (value: string) => void;
  onLanguage: (value: string) => void;
  disabled?: boolean;
}

/** Timezone + language pair for the Space dialog (applies only while protection is on). */
export function RegionFields({ timezone, language, onTimezone, onLanguage, disabled }: RegionFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">
        Timezone
        <RegionSelect label="Timezone" value={timezone} options={TIMEZONE_OPTIONS} onChange={onTimezone} disabled={disabled} className="w-full" />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">
        Language
        <RegionSelect label="Language" value={language} options={LANGUAGE_OPTIONS} onChange={onLanguage} disabled={disabled} className="w-full" />
      </label>
    </div>
  );
}