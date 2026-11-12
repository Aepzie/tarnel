import { useEffect, useId, useState } from 'react';
import { Eraser } from 'lucide-react';
import type { SafetyStatus } from '@shared/ipc';
import { formatCount } from '@/lib/vela';
import { nextDnsTemplate, validateDohTemplate, type SecureDnsMode } from '@shared/doh';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { velaPages } from '@/lib/vela';
import { ConfirmActions } from '../components/confirm';
import { UserAgentPicker } from '../components/user-agent';
import { Group, Row, SectionHeader, SwitchRow } from '../components/layout';
import { hasBridge, useSettings } from '../store';
import { SiteDataOnClose } from './SiteDataOnClose';
import { CookieBanners } from './CookieBanners';
import { EmailAliases } from './EmailAliases';
import { Drm } from './Drm';

const DNS_OPTIONS: readonly { value: SecureDnsMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'automatic', label: 'Automatic' },
  { value: 'cloudflare', label: 'Cloudflare (1.1.1.1)' },
  { value: 'quad9', label: 'Quad9' },
  { value: 'mullvad', label: 'Mullvad' },
  { value: 'mullvad-adblock', label: 'Mullvad (ad blocking)' },
  { value: 'nextdns', label: 'NextDNS' },
  { value: 'custom', label: 'Custom' },
];

const DNS_TEXT: Record<SecureDnsMode, string> = {
  off: 'Lookups use your system’s DNS resolver.',
  automatic: 'Upgrade to DNS-over-HTTPS when your system resolver supports it.',
  cloudflare: 'Encrypt lookups with Cloudflare.',
  quad9: 'Encrypt lookups with Quad9 (blocks known malicious domains).',
  mullvad: 'Encrypt lookups with Mullvad.',
  'mullvad-adblock': 'Encrypt lookups with Mullvad, which also blocks ad and tracker domains.',
  nextdns: 'Encrypt lookups with your NextDNS configuration.',
  custom: 'Encrypt lookups with any DNS-over-HTTPS server.',
};

/** Text field for the NextDNS ID / custom template; saves on Enter or blur, only when valid. */
function DnsServerField({ mode }: { mode: 'nextdns' | 'custom' }) {
  const { settings, update } = useSettings();
  const id = useId();
  const key = mode === 'nextdns' ? 'secureDnsNextDns' : 'secureDnsTemplate';
  const saved = settings[key];
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const valid = draft.trim() === '' || (mode === 'nextdns' ? nextDnsTemplate(draft) : validateDohTemplate(draft)) !== null;
  const commit = (): void => {
    if (valid && draft.trim() !== saved) update({ [key]: draft.trim() });
  };
  const hint = !valid
    ? mode === 'nextdns'
      ? 'Enter a NextDNS configuration ID or https://dns.nextdns.io/… URL.'
      : 'Enter an https:// URL, optionally ending in {?dns}.'
    : saved === ''
      ? 'Secure DNS stays off until this is set.'
      : mode === 'nextdns'
        ? 'Your configuration ID from my.nextdns.io.'
        : 'An RFC 8484 template, e.g. https://dns.example/dns-query{?dns}.';
  return (
    <Row title={mode === 'nextdns' ? 'NextDNS configuration' : 'Server template'} description={hint} htmlFor={id} descriptionId={`${id}-desc`}>
      <Input
        id={id}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        aria-describedby={`${id}-desc`}
        aria-invalid={valid ? undefined : true}
        placeholder={mode === 'nextdns' ? 'abc123' : 'https://dns.example/dns-query'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        className="h-8 w-64 rounded-lg font-mono text-xs md:text-xs"
      />
    </Row>
  );
}

function SecureDns() {
  const { settings, update } = useSettings();
  const id = useId();
  const mode = settings.secureDns;
  const usesServer = mode !== 'off' && mode !== 'automatic';
  return (
    <Group title="Secure DNS">
      <Row
        title="DNS-over-HTTPS"
        description={`${DNS_TEXT[mode]} Applies to every Space at once. Spaces that use a proxy or MantelVPN resolve through it instead.`}
        htmlFor={id}
      >
        <Select value={mode} onValueChange={(value) => update({ secureDns: value as SecureDnsMode })}>
          <SelectTrigger id={id} size="sm" className="h-8 w-48 rounded-lg text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end" sideOffset={6} className="rounded-xl p-0.5 backdrop-blur-xl">
            {DNS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="rounded-lg text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {(mode === 'nextdns' || mode === 'custom') && <DnsServerField key={mode} mode={mode} />}
      {usesServer && (
        <SwitchRow
          title="Strict"
          description="Fail the lookup instead of falling back to unencrypted DNS when the server can’t be reached."
          setting="secureDnsStrict"
        />
      )}
    </Group>
  );
}

function useSafetyStatus(): SafetyStatus | null {
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  useEffect(() => {
    if (!hasBridge()) return;
    velaPages()
      .safety.status()
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  return status;
}

function SafetyDescription() {
  const status = useSafetyStatus();
  const base = 'Checks pages against local phishing and malware lists. Nothing you visit is sent anywhere.';
  if (!status) return base;
  if (!status.updatedAt) return `${base} Lists not downloaded yet.`;
  const when = new Date(status.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `${base} ${formatCount(status.entries)} entries, updated ${when}.`;
}

function UserAgentRow() {
  const { settings, update } = useSettings();
  return (
    <Row title="User agent" description="What sites see as your browser, in every Space without its own. A non-Chromium value can break some sites.">
      <UserAgentPicker label="Default user agent" value={settings.userAgent} defaultLabel="Tarnel default" onChange={(userAgent) => update({ userAgent })} />
    </Row>
  );
}

export function Privacy() {
  return (
    <>
      <SectionHeader title="Privacy" description="Protections that run before a request ever leaves your machine." />
      <Group>
        <SwitchRow title="Block ads and trackers" description="Filter known ad and tracking requests in every Space." setting="adblock" />
        <SwitchRow title="HTTPS-only" description="Upgrade every connection to HTTPS when possible." setting="httpsOnly" />
        <SwitchRow
          title="Block third-party cookies"
          description="Sites can’t follow you across other sites."
          setting="blockThirdPartyCookies"
        />
        <SwitchRow
          title="Send Do Not Track & GPC"
          description="Ask sites not to sell or share your data."
          setting="sendDoNotTrack"
        />
        <SwitchRow title="Warn about dangerous sites" description={<SafetyDescription />} setting="warnDangerousSites" />
        <SwitchRow
          title="Remove tracking parameters"
          description="Strip click and share trackers like utm_ and fbclid from links you open or copy."
          setting="removeTrackingParams"
        />
        <SwitchRow
          title="Trim referrers"
          description="Other sites only learn which site you came from, never the page."
          setting="trimReferrers"
        />
        <UserAgentRow />
      </Group>
      <CookieBanners />
      <Drm />
      <Group title="Privacy report">
        <Row title="Your privacy report" description="What Tarnel blocked this week, per Space. Counted on this device only.">
          <button
            type="button"
            onClick={() => void velaPages().navigate('tarnel://privacy/')}
            className="h-8 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Open
          </button>
        </Row>
        <SwitchRow title="Weekly summary" description="A quiet notification once a week with the numbers." setting="privacyWeeklySummary" />
      </Group>
      <SiteDataOnClose />
      <SecureDns />
      <Group title="Passwords">
        <SwitchRow
          title="Offer to save passwords"
          description="Ask after you sign in. Passwords are encrypted by your OS and stay in their Space."
          setting="offerToSavePasswords"
        />
        <SwitchRow title="Auto-fill" description="Offer saved accounts on sign-in forms. Nothing is filled until you pick one." setting="passwordAutofill" />
        <Row title="Saved passwords" description="View, edit, export or delete saved passwords.">
          <button
            type="button"
            onClick={() => void velaPages().navigate('tarnel://passwords/')}
            className="h-8 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Manage
          </button>
        </Row>
      </Group>
      <EmailAliases />
      <Group title="History">
        <Row title="Browsing history" description="Removes visited pages and top sites from every Space.">
          <ConfirmActions
            actions={[
              {
                id: 'clear-history',
                label: 'Clear browsing history',
                icon: Eraser,
                danger: true,
                disabled: !hasBridge(),
                message: 'Clear all history?',
                confirmLabel: 'Clear history',
                successLabel: 'History cleared',
                run: () => velaPages().clearHistory(),
              },
            ]}
          />
        </Row>
      </Group>
      <Group title="Panic button">
        <SwitchRow
          title="Also clear the last 15 minutes of history"
          description="Ctrl+Shift+Delete or “Panic” in the command palette hides Tarnel, mutes every tab, disconnects the VPN and wipes all Burner Spaces. Nothing else is deleted unless this is on."
          setting="panicClearRecentHistory"
        />
      </Group>
    </>
  );
}
