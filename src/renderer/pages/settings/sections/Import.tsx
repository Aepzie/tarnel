import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Check, FileText, Loader2, X } from 'lucide-react';
import { HISTORY_IMPORT_DAYS, HISTORY_IMPORT_LIMIT, type BrowserProfile, type ImportKind, type PasswordCsvPreview } from '@shared/import';
import type { Space } from '@shared/types';
import { ease } from '@/lib/motion';
import { velaPages } from '@/lib/vela';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Group, Row, SectionHeader } from '../components/layout';
import { errorText, hasBridge } from '../store';

type StepKind = ImportKind | 'passwords';
type StepState = { kind: StepKind; status: 'pending' | 'running' | 'done' | 'error'; count?: number; error?: string };

const STEP_LABEL: Record<StepKind, string> = { bookmarks: 'Bookmarks', history: 'History', passwords: 'Passwords' };

const EXPORT_HELP: readonly { browser: string; steps: string }[] = [
  { browser: 'Chrome', steps: 'chrome://password-manager/settings → Export passwords' },
  { browser: 'Edge', steps: 'edge://wallet/passwords → ⋯ → Export passwords' },
  { browser: 'Brave', steps: 'brave://password-manager/settings → Export passwords' },
  { browser: 'Firefox', steps: 'about:logins → ⋯ → Export passwords' },
  { browser: 'Bitwarden', steps: 'Tools → Export vault → File format .csv' },
  { browser: '1Password', steps: 'File → Export → CSV' },
];

const fmt = (n: number): string => n.toLocaleString();

function summary(steps: readonly StepState[]): string {
  const unit: Record<StepKind, [string, string]> = {
    bookmarks: ['bookmark', 'bookmarks'],
    history: ['history entry', 'history entries'],
    passwords: ['password', 'passwords'],
  };
  return steps
    .filter((step) => step.status === 'done')
    .map((step) => `${fmt(step.count ?? 0)} ${unit[step.kind][step.count === 1 ? 0 : 1]}`)
    .join(', ');
}

function profileLabel(profile: BrowserProfile, all: readonly BrowserProfile[]): string {
  const siblings = all.filter((other) => other.browser === profile.browser).length;
  return siblings > 1 ? `${profile.browserName} · ${profile.profileName}` : profile.browserName;
}

function StepIcon({ status }: { status: StepState['status'] }) {
  if (status === 'running') return <Loader2 className="size-3.5 animate-spin text-muted-foreground" strokeWidth={2} aria-hidden />;
  if (status === 'done') return <Check className="size-3.5 text-space" strokeWidth={2.5} aria-hidden />;
  if (status === 'error') return <AlertCircle className="size-3.5 text-destructive" strokeWidth={2} aria-hidden />;
  return <span className="size-1.5 rounded-full bg-muted-foreground/40" aria-hidden />;
}

export function Import() {
  const [profiles, setProfiles] = useState<BrowserProfile[] | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [profileId, setProfileId] = useState<string>('');
  const [spaceId, setSpaceId] = useState<string>('');
  const [kinds, setKinds] = useState<Record<ImportKind, boolean>>({ bookmarks: true, history: true });
  const [csv, setCsv] = useState<PasswordCsvPreview | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepState[] | null>(null);
  const [running, setRunning] = useState(false);
  const browserId = useId();
  const spaceSelectId = useId();
  const bookmarksId = useId();
  const historyId = useId();

  useEffect(() => {
    if (!hasBridge()) {
      setProfiles([]);
      return;
    }
    let alive = true;
    velaPages()
      .browserImport.profiles()
      .then(
        (list) => {
          if (!alive) return;
          setProfiles(list);
          setProfileId((current) => current || list[0]?.id || '');
        },
        () => alive && setProfiles([]),
      );
    Promise.all([velaPages().listSpaces(), velaPages().currentSpace()]).then(
      ([list, current]) => {
        if (!alive) return;
        const persistent = list.filter((space) => !space.ephemeral);
        setSpaces(persistent);
        const preferred = persistent.find((space) => space.id === current?.id) ?? persistent[0];
        setSpaceId((existing) => existing || preferred?.id || '');
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!csv) return;
    const token = csv.token;
    return () => {
      if (hasBridge()) velaPages().browserImport.discardPasswords(token).catch(() => undefined);
    };
  }, [csv]);

  const profile = profiles?.find((entry) => entry.id === profileId) ?? null;
  const wanted: StepKind[] = [
    ...(profile && kinds.bookmarks && profile.hasBookmarks ? (['bookmarks'] as const) : []),
    ...(profile && kinds.history && profile.hasHistory ? (['history'] as const) : []),
    ...(csv ? (['passwords'] as const) : []),
  ];
  const canRun = !running && !!spaceId && wanted.length > 0;

  const pickCsv = async () => {
    setCsvError(null);
    try {
      const preview = await velaPages().browserImport.pickPasswordCsv();
      if (preview) setCsv(preview);
    } catch (error) {
      setCsvError(errorText(error, 'Tarnel could not read that file.'));
    }
  };

  const start = async () => {
    if (!canRun) return;
    setRunning(true);
    const plan: StepState[] = wanted.map((kind) => ({ kind, status: 'pending' }));
    setSteps(plan);
    const patch = (index: number, next: Partial<StepState>) => {
      plan[index] = { ...plan[index]!, ...next };
      setSteps([...plan]);
    };
    for (const [index, step] of plan.entries()) {
      patch(index, { status: 'running' });
      try {
        if (step.kind === 'passwords') {
          const result = await velaPages().browserImport.importPasswords(csv!.token, spaceId);
          setCsv(null);
          patch(index, { status: 'done', count: result.added + result.updated });
        } else {
          patch(index, { status: 'done', count: await velaPages().browserImport.run(profileId, step.kind, spaceId) });
        }
      } catch (error) {
        patch(index, { status: 'error', error: errorText(error, 'Import failed.') });
      }
    }
    setRunning(false);
  };

  const done = steps && !running ? summary(steps) : '';

  return (
    <>
      <SectionHeader title="Import" description="Bring bookmarks, history and passwords over from another browser." />

      <Group title="From a browser">
        {profiles && profiles.length === 0 ? (
          <Row title="No other browsers found" description="Chrome, Edge, Brave, Vivaldi, Opera, Chromium and Firefox are supported.">
            <span />
          </Row>
        ) : (
          <>
            <Row title="Browser" htmlFor={browserId} description="Close the other browser first for the most recent history.">
              <Select value={profileId} onValueChange={setProfileId} disabled={!profiles || running}>
                <SelectTrigger id={browserId} size="sm" className="h-8 w-52 rounded-lg text-xs">
                  <SelectValue placeholder={profiles ? 'Choose' : 'Looking…'} />
                </SelectTrigger>
                <SelectContent position="popper" align="end" sideOffset={6} className="rounded-xl p-0.5 backdrop-blur-xl">
                  {(profiles ?? []).map((entry) => (
                    <SelectItem key={entry.id} value={entry.id} className="rounded-lg text-xs">
                      {profileLabel(entry, profiles ?? [])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row title="Bookmarks" htmlFor={bookmarksId} description="Added as a new folder, nothing is overwritten.">
              <Switch
                id={bookmarksId}
                checked={kinds.bookmarks && !!profile?.hasBookmarks}
                disabled={!profile?.hasBookmarks || running}
                onCheckedChange={(checked) => setKinds((current) => ({ ...current, bookmarks: checked }))}
              />
            </Row>
            <Row
              title="History"
              htmlFor={historyId}
              description={`Most visited pages of the last ${HISTORY_IMPORT_DAYS} days, up to ${fmt(HISTORY_IMPORT_LIMIT)}. History is shared by all Spaces.`}
            >
              <Switch
                id={historyId}
                checked={kinds.history && !!profile?.hasHistory}
                disabled={!profile?.hasHistory || running}
                onCheckedChange={(checked) => setKinds((current) => ({ ...current, history: checked }))}
              />
            </Row>
          </>
        )}
      </Group>

      <Group title="Passwords">
        <Row
          title={csv ? csv.fileName : 'Passwords file'}
          description={
            csv
              ? `${fmt(csv.count)} ${csv.count === 1 ? 'login' : 'logins'} · ${csv.format}${csv.skipped ? ` · ${fmt(csv.skipped)} skipped` : ''}`
              : 'Tarnel never reads other browsers’ password stores. Export a CSV file and choose it here.'
          }
        >
          {csv ? (
            <Button variant="ghost" size="sm" onClick={() => setCsv(null)} disabled={running} aria-label="Remove file">
              <X className="size-3.5" strokeWidth={2} aria-hidden />
              Remove
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void pickCsv()} disabled={running || !hasBridge()}>
              <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
              Choose CSV…
            </Button>
          )}
        </Row>
        {csvError && (
          <div role="alert" className="flex items-center gap-1.5 px-4 py-2.5 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {csvError}
          </div>
        )}
        <details className="group px-4 py-3">
          <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">How to export passwords</summary>
          <dl className="mt-2.5 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-xs">
            {EXPORT_HELP.map((entry) => (
              <div key={entry.browser} className="contents">
                <dt className="text-foreground">{entry.browser}</dt>
                <dd className="font-mono text-[11px] leading-5 text-muted-foreground">{entry.steps}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2.5 text-xs text-muted-foreground">The exported file is not encrypted. Delete it once the import is done.</p>
        </details>
      </Group>

      <Group>
        <Row title="Into Space" htmlFor={spaceSelectId} description="Bookmarks and passwords belong to this Space.">
          <Select value={spaceId} onValueChange={setSpaceId} disabled={running || spaces.length === 0}>
            <SelectTrigger id={spaceSelectId} size="sm" className="h-8 w-40 rounded-lg text-xs">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent position="popper" align="end" sideOffset={6} className="rounded-xl p-0.5 backdrop-blur-xl">
              {spaces.map((space) => (
                <SelectItem key={space.id} value={space.id} className="rounded-lg text-xs">
                  {space.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground" role="status" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {steps ? (
                <motion.ul
                  key="steps"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.18, ease: ease.out } }}
                  className="flex flex-col gap-1"
                >
                  {steps.map((step) => (
                    <li key={step.kind} className="flex items-center gap-2">
                      <span className="grid size-3.5 place-items-center">
                        <StepIcon status={step.status} />
                      </span>
                      <span className="text-foreground">{STEP_LABEL[step.kind]}</span>
                      {step.status === 'done' && <span className="tabular-nums">{fmt(step.count ?? 0)}</span>}
                      {step.status === 'error' && <span className="truncate text-destructive">{step.error}</span>}
                    </li>
                  ))}
                  {done && <li className="pt-1 text-foreground">Imported {done}.</li>}
                </motion.ul>
              ) : (
                <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  {wanted.length ? `Imports ${wanted.map((kind) => STEP_LABEL[kind].toLowerCase()).join(', ')}.` : 'Nothing selected.'}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <Button size="sm" onClick={() => void start()} disabled={!canRun}>
            {running && <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden />}
            {running ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </Group>
    </>
  );
}
