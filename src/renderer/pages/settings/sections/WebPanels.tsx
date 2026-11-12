import { useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { normalizePanelUrl, type PanelsState } from '@shared/panels';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Group, Row, SwitchRow } from '../components/layout';
import { errorText } from '../store';

/** Settings → Appearance → Web panels: rail toggle and the panel list (add, mobile layout, remove). */
export function WebPanels() {
  const api = window.velaPages?.panels;
  const [state, setState] = useState<PanelsState>({ panels: [], openId: null });
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api?.list().then(setState).catch(() => undefined);
  }, [api]);

  if (!api) return null;

  const add = (event: FormEvent): void => {
    event.preventDefault();
    if (!normalizePanelUrl(url)) {
      setError('Enter a web address (https://…)');
      return;
    }
    api
      .add({ name: '', url })
      .then((next) => {
        setState(next);
        setUrl('');
        setError(null);
      })
      .catch((reason: unknown) => setError(errorText(reason, 'Could not add this panel')));
  };

  return (
    <Group title="Web panels">
      <SwitchRow
        title="Show panel rail"
        setting="showPanelRail"
        description="Pinned web apps on the right edge, each in its own isolated session. Turns on when you add a panel."
      />
      {state.panels.map((panel) => (
        <Row
          key={panel.id}
          title={
            <span className="flex min-w-0 items-center gap-2">
              {panel.favicon ? <img src={panel.favicon} alt="" className="size-4 rounded-[3px]" /> : <span className="size-4 rounded-[4px] bg-muted" />}
              <span className="truncate">{panel.name}</span>
            </span>
          }
          description={<span className="block truncate">{panel.url}</span>}
        >
          <label className="mr-3 flex items-center gap-2 text-xs text-muted-foreground">
            Mobile layout
            <Switch checked={panel.mobile} onCheckedChange={(mobile) => void api.update(panel.id, { mobile }).then(setState).catch(() => undefined)} />
          </label>
          <button
            type="button"
            aria-label={`Remove ${panel.name}`}
            title="Remove panel"
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
            onClick={() => void api.remove(panel.id).then(setState).catch(() => undefined)}
          >
            <Trash2 size={15} strokeWidth={1.75} />
          </button>
        </Row>
      ))}
      <form onSubmit={add}>
        <Row title="Add panel" description={error ?? 'WhatsApp Web, Telegram, Discord, Spotify, a calendar… any web address.'}>
          <div className="flex items-center gap-2">
            <Input
              value={url}
              spellCheck={false}
              placeholder="https://web.whatsapp.com"
              aria-label="Panel address"
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
              className="h-8 w-64 text-[13px]"
            />
            <button
              type="submit"
              disabled={!url.trim()}
              className="h-8 rounded-lg px-3 text-[13px] font-medium ring-1 ring-border transition-colors duration-150 hover:bg-accent disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </Row>
      </form>
    </Group>
  );
}
