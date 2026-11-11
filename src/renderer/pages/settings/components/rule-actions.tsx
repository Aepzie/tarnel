import { Ban, Fingerprint, Globe, Layers, MonitorSmartphone, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { Space } from '@shared/types';
import { RULE_FINGERPRINT_LEVELS, type RuleFingerprintLevel, type SiteRuleAction, type SiteRuleActionKind, type SiteRulesContext } from '@shared/site-rules';
import { userAgentPresets } from '@shared/user-agent';
import { RegionSelect } from '@/chrome/spaces/FingerprintPicker';
import { UserAgentPicker } from './user-agent';

/** Card types of the rules editor: the trigger plus one per action kind. */
export type RuleCardKind = 'domain' | SiteRuleActionKind;

export interface RuleCardMeta {
  kind: RuleCardKind;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export const RULE_CARDS: readonly RuleCardMeta[] = [
  { kind: 'domain', label: 'Domain', hint: 'When a tab opens this site', icon: Globe },
  { kind: 'space', label: 'Open in Space', hint: 'Move the tab into a Space', icon: Layers },
  { kind: 'vpn', label: 'VPN', hint: 'Route the tab through MantelVPN', icon: ShieldCheck },
  { kind: 'fingerprint', label: 'Fingerprint', hint: 'Protection level for this site', icon: Fingerprint },
  { kind: 'userAgent', label: 'User agent', hint: 'Identify as another browser', icon: MonitorSmartphone },
  { kind: 'block', label: 'Block site', hint: 'Never load this site', icon: Ban },
];

export function cardMeta(kind: RuleCardKind): RuleCardMeta {
  return RULE_CARDS.find((card) => card.kind === kind) ?? RULE_CARDS[0]!;
}

const FINGERPRINT_LABELS: Record<RuleFingerprintLevel, string> = {
  off: 'Off',
  standard: 'Standard',
  strict: 'Strict',
  random: 'Random per visit',
};

/** Countries offered while signed out (routing needs a sign-in; the rule can be prepared anyway). */
const FALLBACK_COUNTRIES = [
  ['de', 'Germany'],
  ['nl', 'Netherlands'],
  ['ch', 'Switzerland'],
  ['se', 'Sweden'],
  ['gb', 'United Kingdom'],
  ['us', 'United States'],
  ['jp', 'Japan'],
] as const;

const FIRST_UA = userAgentPresets(0)[0]!.value;

export function defaultAction(kind: SiteRuleActionKind, spaces: readonly Space[], context: SiteRulesContext): SiteRuleAction {
  switch (kind) {
    case 'space':
      return { kind, spaceId: spaces[0]?.id ?? 'default' };
    case 'vpn':
      return { kind, country: context.countries[0]?.code ?? 'de' };
    case 'fingerprint':
      return { kind, level: 'strict' };
    case 'userAgent':
      return { kind, value: FIRST_UA };
    case 'block':
      return { kind };
  }
}

/** One-line summary for the list view, the tester and screen readers. */
export function describeAction(action: SiteRuleAction, spaces: readonly Space[]): string {
  switch (action.kind) {
    case 'space':
      return `Open in ${spaces.find((space) => space.id === action.spaceId)?.name ?? 'a removed Space'}`;
    case 'vpn':
      return `VPN ${action.country.toUpperCase()}`;
    case 'fingerprint':
      return `Fingerprint ${FINGERPRINT_LABELS[action.level].toLowerCase()}`;
    case 'userAgent':
      return 'Own user agent';
    case 'block':
      return 'Blocked';
  }
}

interface ActionFieldsProps {
  action: SiteRuleAction;
  spaces: readonly Space[];
  context: SiteRulesContext;
  onChange: (action: SiteRuleAction) => void;
}

/** The editable value of an action card (shared by the workflow and the list view). */
export function ActionFields({ action, spaces, context, onChange }: ActionFieldsProps) {
  switch (action.kind) {
    case 'space':
      return (
        <RegionSelect
          label="Space"
          value={action.spaceId}
          options={spaces.map((space) => ({ value: space.id, label: space.name }))}
          onChange={(spaceId) => spaceId && onChange({ kind: 'space', spaceId })}
          className="w-full"
        />
      );
    case 'vpn': {
      const countries = context.countries.length > 0 ? context.countries.map((country) => [country.code, country.name] as const) : FALLBACK_COUNTRIES;
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <RegionSelect
            label="VPN country"
            value={action.country}
            options={countries.map(([code, name]) => ({ value: code, label: name }))}
            onChange={(country) => country && onChange({ kind: 'vpn', country })}
            className="w-full"
          />
          {!context.vpnSignedIn && <p className="text-[11px] leading-4 text-muted-foreground">Needs a MantelVPN sign-in (VPN menu). Skipped until then.</p>}
        </div>
      );
    }
    case 'fingerprint':
      return (
        <RegionSelect
          label="Fingerprint protection"
          value={action.level}
          options={RULE_FINGERPRINT_LEVELS.map((level) => ({ value: level, label: FINGERPRINT_LABELS[level] }))}
          onChange={(level) => level && onChange({ kind: 'fingerprint', level: level as RuleFingerprintLevel })}
          className="w-full"
        />
      );
    case 'userAgent':
      return (
        <UserAgentPicker label="User agent" value={action.value} defaultLabel="Choose…" onChange={(value) => value && onChange({ kind: 'userAgent', value })} />
      );
    case 'block':
      return <p className="text-[12px] text-muted-foreground">Navigation is cancelled.</p>;
  }
}
