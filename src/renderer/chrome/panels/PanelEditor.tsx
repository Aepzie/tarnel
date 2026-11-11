import { useState, type FormEvent } from 'react';
import { normalizePanelUrl, PANEL_NAME_MAX, PANEL_SUGGESTIONS, type PanelInput, type WebPanel } from '@shared/panels';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** Add / edit form for a web panel (rail "+" popover and "Change URL…"). */
export function PanelEditor({
  panel,
  onSubmit,
  onCancel,
}: {
  panel?: WebPanel;
  onSubmit: (input: PanelInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(panel?.name ?? '');
  const [url, setUrl] = useState(panel?.url ?? '');
  const [mobile, setMobile] = useState(panel?.mobile ?? false);
  const [error, setError] = useState<string | null>(null);
  const valid = normalizePanelUrl(url) !== null;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!valid) {
      setError('Enter a web address (https://…)');
      return;
    }
    onSubmit({ name, url, mobile }).catch(() => setError('Could not save this panel'));
  };

  return (
    <form className="flex flex-col gap-3 p-3" onSubmit={submit}>
      <div className="text-[13px] font-medium">{panel ? 'Edit panel' : 'Add web panel'}</div>
      {!panel && (
        <div className="flex flex-wrap gap-1.5">
          {PANEL_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.url}
              type="button"
              className={cn(
                'h-6 rounded-full px-2.5 text-[11.5px] text-muted-foreground ring-1 ring-white/[0.08] transition-colors duration-150 hover:bg-accent hover:text-foreground light:ring-black/[0.08]',
                url === suggestion.url && 'text-foreground ring-[color-mix(in_oklab,var(--accent-space)_55%,transparent)]',
              )}
              onClick={() => {
                setName(suggestion.name);
                setUrl(suggestion.url);
                setMobile(suggestion.mobile);
                setError(null);
              }}
            >
              {suggestion.name}
            </button>
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
        Address
        <Input
          autoFocus
          value={url}
          placeholder="https://web.whatsapp.com"
          spellCheck={false}
          onChange={(event) => {
            setUrl(event.target.value);
            setError(null);
          }}
          className="h-8 text-[13px]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
        Name
        <Input value={name} maxLength={PANEL_NAME_MAX} placeholder="Optional" onChange={(event) => setName(event.target.value)} className="h-8 text-[13px]" />
      </label>
      <label className="flex items-center justify-between gap-3 text-[12.5px]">
        <span>
          Mobile layout
          <span className="block text-[11.5px] text-muted-foreground">Ask the site for its phone version</span>
        </span>
        <Switch checked={mobile} onCheckedChange={setMobile} />
      </label>
      {error && <div className="text-[12px] text-destructive">{error}</div>}
      <div className="flex justify-end gap-1.5">
        <button type="button" className="h-7 rounded-lg px-3 text-[12.5px] text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={!url.trim()}
          className="h-7 rounded-lg bg-white/[0.08] px-3 text-[12.5px] font-medium ring-1 ring-white/[0.08] hover:bg-white/[0.12] disabled:opacity-40 light:bg-black/[0.06] light:ring-black/[0.08] light:hover:bg-black/[0.09]"
        >
          {panel ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  );
}
