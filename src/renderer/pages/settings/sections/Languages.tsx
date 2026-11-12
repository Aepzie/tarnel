import { useEffect, useId, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { languageName, type TranslateOverview, type TranslatePrefs } from '@shared/translate';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { velaPages } from '@/lib/vela';
import { Group, Row } from '../components/layout';
import { hasBridge } from '../store';

const chipButton =
  'flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

/** Settings → General → Languages: on-device translation target, auto-translate list, downloaded models. */
export function Languages() {
  const [overview, setOverview] = useState<TranslateOverview | null>(null);
  const targetId = useId();
  const offerId = useId();
  const alwaysId = useId();

  useEffect(() => {
    if (!hasBridge()) return;
    void velaPages().translate.overview().then(setOverview).catch(() => undefined);
  }, []);

  if (!overview) return null;
  const { prefs, languages, installed, pairs } = overview;
  const save = (patch: Partial<TranslatePrefs>): void => {
    setOverview({ ...overview, prefs: { ...prefs, ...patch } });
    void velaPages().translate.setPrefs(patch).then(setOverview).catch(() => undefined);
  };
  const remove = (pair: string): void => {
    void velaPages().translate.deleteModel(pair).then(setOverview).catch(() => undefined);
  };
  const addable = languages.filter((language) => language.code !== prefs.targetLang && !prefs.alwaysTranslate.includes(language.code));

  return (
    <Group title="Languages">
      <Row title="Translate pages into" description="Pages are translated on this device. Only the language model is downloaded from Mozilla, never the page text." htmlFor={targetId}>
        <Select value={prefs.targetLang} onValueChange={(value) => save({ targetLang: value })}>
          <SelectTrigger id={targetId} size="sm" className="h-8 w-44 rounded-lg text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end" sideOffset={6} className="max-h-72 rounded-xl p-0.5 backdrop-blur-xl">
            {languages.map((language) => (
              <SelectItem key={language.code} value={language.code} className="rounded-lg text-xs">
                {language.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row title="Offer to translate" description="Show the translate button in the address bar when a page is in another language." htmlFor={offerId}>
        <Switch id={offerId} checked={prefs.offer} onCheckedChange={(checked) => save({ offer: checked })} />
      </Row>
      <Row title="Always translate" description="Pages in these languages are translated as soon as they load." htmlFor={alwaysId}>
        <Select value="" onValueChange={(value) => save({ alwaysTranslate: [...prefs.alwaysTranslate, value] })}>
          <SelectTrigger id={alwaysId} size="sm" className="h-8 w-44 rounded-lg text-xs">
            <SelectValue placeholder="Add a language" />
          </SelectTrigger>
          <SelectContent position="popper" align="end" sideOffset={6} className="max-h-72 rounded-xl p-0.5 backdrop-blur-xl">
            {addable.map((language) => (
              <SelectItem key={language.code} value={language.code} className="rounded-lg text-xs">
                {language.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {prefs.alwaysTranslate.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-4 pb-3">
          {prefs.alwaysTranslate.map((code) => (
            <li key={code} className="flex h-7 items-center gap-1 rounded-full bg-secondary pr-1 pl-2.5 text-[12px] text-foreground ring-1 ring-border">
              {languageName(code)}
              <button type="button" aria-label={`Stop always translating ${languageName(code)}`} onClick={() => save({ alwaysTranslate: prefs.alwaysTranslate.filter((entry) => entry !== code) })} className={chipButton}>
                <X className="size-3" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="px-4 py-3">
        <p className="text-[13px] leading-5 font-medium text-foreground">Downloaded language models</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          Downloaded when first needed (about 35 MB per direction).{' '}
          {pairs.length > 0 ? `${pairs.length} directions available; other languages translate via English.` : ''}
        </p>
        {installed.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground/70">No models downloaded.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg ring-1 ring-border">
            {installed.map((model) => (
              <li key={model.pair} className="flex h-9 items-center gap-2 px-3 text-[12.5px] text-foreground">
                <span className="min-w-0 flex-1 truncate">
                  {languageName(model.from)} → {languageName(model.to)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{megabytes(model.bytes)}</span>
                <button type="button" aria-label={`Delete ${languageName(model.from)} to ${languageName(model.to)} model`} onClick={() => remove(model.pair)} className={chipButton}>
                  <Trash2 className="size-3" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Group>
  );
}
