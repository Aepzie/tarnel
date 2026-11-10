import { Eraser } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SafetyStatus } from '@shared/ipc';
import { formatCount, velaPages } from '@/lib/vela';
import { ConfirmActions } from '../components/confirm';
import { Group, Row, SectionHeader, SwitchRow } from '../components/layout';
import { hasBridge } from '../store';

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
      </Group>
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
    </>
  );
}
