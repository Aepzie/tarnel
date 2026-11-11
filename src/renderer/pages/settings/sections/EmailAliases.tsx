import { useEffect, useId, useState } from 'react';
import { ALIAS_PROVIDERS, type AliasOptions, type AliasProviderId, type AliasSettingsView, type AliasStyle } from '@shared/aliases';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { velaPages } from '@/lib/vela';
import { Group, Row } from '../components/layout';

const STYLE_OPTIONS: readonly { value: AliasStyle; label: string }[] = [
  { value: 'words', label: 'Random words' },
  { value: 'chars', label: 'Random characters' },
  { value: 'site', label: 'Based on site name' },
];

const DEFAULT = '__default';
const triggerClass = 'h-8 w-48 rounded-lg text-xs';
const contentClass = 'rounded-xl p-0.5 backdrop-blur-xl';
const button = 'h-8 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50';

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (Error: |TypeError: )?/, '');
}

function Choice({ id, value, options, onChange }: { id: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} size="sm" className={triggerClass}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end" sideOffset={6} className={contentClass}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="rounded-lg text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Settings → Privacy → Email aliases. The API key is write-only from here. */
export function EmailAliases() {
  const api = velaPages().aliases;
  const [view, setView] = useState<AliasSettingsView | null>(null);
  const [options, setOptions] = useState<AliasOptions | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerId = useId();
  const keyId = useId();
  const styleId = useId();
  const domainId = useId();
  const mailboxId = useId();

  useEffect(() => {
    void api?.get().then(setView).catch(() => undefined);
  }, [api]);

  const ready = !!view?.provider && view.hasKey;
  useEffect(() => {
    setOptions(null);
    if (!ready) return;
    void api?.options().then(setOptions).catch(() => undefined);
  }, [api, ready, view?.provider]);

  if (!api || !view) return null;

  const run = (task: Promise<AliasSettingsView>): void => {
    setBusy(true);
    setError(null);
    task
      .then((next) => {
        setView(next);
        setKey('');
      })
      .catch((reason: unknown) => setError(message(reason)))
      .finally(() => setBusy(false));
  };

  const provider = view.provider ?? 'off';
  return (
    <Group title="Email aliases">
      <Row title="Provider" description="Offer a forwarding address on sign-up forms. Created only when you click it." htmlFor={providerId}>
        <Choice
          id={providerId}
          value={provider}
          options={[{ value: 'off', label: 'Off' }, ...ALIAS_PROVIDERS.map((entry) => ({ value: entry.id, label: entry.label }))]}
          onChange={(value) => run(api.set({ provider: value === 'off' ? null : (value as AliasProviderId) }))}
        />
      </Row>
      {view.provider && (
        <Row
          title="API key"
          htmlFor={keyId}
          description={
            error ??
            (view.account
              ? `Connected as ${view.account.name} · ${view.account.plan}. Stored encrypted by your OS, never shown to pages.`
              : view.encryption
                ? 'Checked with the provider, then stored encrypted by your OS.'
                : 'OS encryption is not available, so a key cannot be stored.')
          }
        >
          {view.hasKey ? (
            <button type="button" className={button} disabled={busy} onClick={() => run(api.setKey(null))}>
              Remove key
            </button>
          ) : (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (key.trim()) run(api.setKey(key));
              }}
            >
              <Input
                id={keyId}
                type="password"
                value={key}
                autoComplete="off"
                spellCheck={false}
                disabled={busy || !view.encryption}
                placeholder="Paste API key"
                onChange={(event) => setKey(event.target.value)}
                className="h-8 w-48 rounded-lg font-mono text-xs md:text-xs"
              />
              <button type="submit" className={button} disabled={busy || !key.trim()}>
                {busy ? 'Checking…' : 'Connect'}
              </button>
            </form>
          )}
        </Row>
      )}
      {ready && (
        <Row title="Alias style" description="How new addresses look." htmlFor={styleId}>
          <Choice id={styleId} value={view.style} options={STYLE_OPTIONS} onChange={(value) => run(api.set({ style: value as AliasStyle }))} />
        </Row>
      )}
      {ready && options && options.domains.length > 0 && (
        <Row title="Domain" description="Domain new aliases use." htmlFor={domainId}>
          <Choice
            id={domainId}
            value={view.domain ?? DEFAULT}
            options={[{ value: DEFAULT, label: 'Account default' }, ...options.domains.map((entry) => ({ value: entry.id, label: entry.label }))]}
            onChange={(value) => run(api.set({ domain: value === DEFAULT ? null : value }))}
          />
        </Row>
      )}
      {ready && options && options.mailboxes.length > 1 && (
        <Row title="Forward to" description={view.provider === 'simplelogin' ? 'Mailbox for aliases based on the site name; random aliases use your default.' : 'Recipient of mail sent to new aliases.'} htmlFor={mailboxId}>
          <Choice
            id={mailboxId}
            value={view.mailbox ?? DEFAULT}
            options={[{ value: DEFAULT, label: 'Account default' }, ...options.mailboxes.map((entry) => ({ value: entry.id, label: entry.label }))]}
            onChange={(value) => run(api.set({ mailbox: value === DEFAULT ? null : value }))}
          />
        </Row>
      )}
    </Group>
  );
}
