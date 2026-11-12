import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { List, Plus, Trash2, Workflow } from 'lucide-react';
import type { Space } from '@shared/types';
import {
  SITE_RULE_ACTION_KINDS,
  normalizeSitePattern,
  type SiteRule,
  type SiteRuleAction,
  type SiteRuleActionKind,
  type SiteRuleResolution,
  type SiteRulesContext,
} from '@shared/site-rules';
import { rise } from '@/lib/motion';
import { velaPages } from '@/lib/vela';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { RegionSelect } from '@/chrome/spaces/FingerprintPicker';
import { Segmented } from '../components/controls';
import { Group, SectionHeader } from '../components/layout';
import { ActionFields, cardMeta, defaultAction, describeAction, type RuleCardKind } from '../components/rule-actions';
import { PatternInput, RuleCanvas, type DraftAction } from '../components/rule-canvas';
import { errorText, hasBridge, useSettings } from '../store';

type View = 'workflow' | 'list';
const VIEW_KEY = 'vela.rules.view';
const EMPTY_CONTEXT: SiteRulesContext = { vpnSignedIn: false, countries: [] };

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function storedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'workflow';
  } catch {
    return 'workflow';
  }
}

function withAction(rule: SiteRule, action: SiteRuleAction): SiteRule {
  const exists = rule.actions.some((entry) => entry.kind === action.kind);
  return { ...rule, actions: exists ? rule.actions.map((entry) => (entry.kind === action.kind ? action : entry)) : [...rule.actions, action] };
}

function Tester({ rules, spaces }: { rules: readonly SiteRule[]; spaces: readonly Space[] }) {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<SiteRuleResolution | null>(null);

  useEffect(() => {
    const input = url.trim();
    if (!input || !hasBridge()) {
      setResult(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      velaPages()
        .siteRules.test(input)
        .then(
          (next) => alive && setResult(next),
          () => alive && setResult(null),
        );
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [url, rules]);

  const applied = result
    ? [
        result.block ? 'Blocked' : null,
        result.space ? describeAction({ kind: 'space', spaceId: result.space }, spaces) : null,
        result.vpn ? `VPN ${result.vpn.toUpperCase()}` : null,
        result.fingerprint ? describeAction({ kind: 'fingerprint', level: result.fingerprint }, spaces) : null,
        result.userAgent ? 'Own user agent' : null,
      ].filter((entry): entry is string => !!entry)
    : [];

  return (
    <motion.section variants={rise} className="mb-6">
      <label htmlFor="rules-test" className="mb-2 block px-1 text-xs font-medium text-muted-foreground">
        Which rules apply to…
      </label>
      <Input id="rules-test" value={url} spellCheck={false} placeholder="https://www.example.com/page" onChange={(event) => setUrl(event.target.value)} className="h-9 text-[13px]" />
      <p className="mt-2 min-h-5 px-1 text-[12px] text-muted-foreground" role="status" aria-live="polite">
        {result &&
          (result.host === null
            ? 'Rules only apply to web pages (http and https).'
            : result.matched.length === 0
              ? `No rule applies to ${result.host}.`
              : `${result.matched.map((rule) => rule.pattern).join(', ')} → ${applied.join(' · ') || 'no actions'}`)}
      </p>
    </motion.section>
  );
}

function ListView(props: {
  rules: readonly SiteRule[];
  spaces: readonly Space[];
  context: SiteRulesContext;
  invalid: ReadonlySet<string>;
  focusRuleId: string | null;
  onPattern: (ruleId: string, pattern: string) => void;
  onToggle: (ruleId: string, enabled: boolean) => void;
  onRemoveRule: (ruleId: string) => void;
  onActionChange: (ruleId: string, kind: string, action: SiteRuleAction) => void;
  onRemoveAction: (ruleId: string, kind: string) => void;
  onAdd: (kind: RuleCardKind, ruleId: string | null) => void;
}) {
  const { rules, spaces, context } = props;
  if (rules.length === 0) {
    return (
      <Group>
        <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">No rules yet.</p>
      </Group>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule) => {
        const missing = SITE_RULE_ACTION_KINDS.filter((kind) => !rule.actions.some((action) => action.kind === kind));
        return (
          <Group key={rule.id} className="mb-0">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <PatternInput rule={rule} invalid={props.invalid.has(rule.id)} autoFocus={props.focusRuleId === rule.id} onCommit={(pattern) => props.onPattern(rule.id, pattern)} />
              </div>
              <Switch checked={rule.enabled} onCheckedChange={(enabled) => props.onToggle(rule.id, enabled)} aria-label={`Rule for ${rule.pattern || 'new domain'} enabled`} />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete rule for ${rule.pattern || 'new domain'}`} onClick={() => props.onRemoveRule(rule.id)} className="text-muted-foreground hover:text-foreground">
                <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
              </Button>
            </div>
            {rule.actions.map((action) => {
              const meta = cardMeta(action.kind);
              return (
                <div key={action.kind} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-28 shrink-0 text-[12px] font-medium">{meta.label}</span>
                  <div className="min-w-0 flex-1">
                    <ActionFields action={action} spaces={spaces} context={context} onChange={(next) => props.onActionChange(rule.id, action.kind, next)} />
                  </div>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${meta.label}`} onClick={() => props.onRemoveAction(rule.id, action.kind)} className="text-muted-foreground hover:text-foreground">
                    <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                  </Button>
                </div>
              );
            })}
            {missing.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2.5">
                <Plus className="size-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                <RegionSelect
                  label="Add action"
                  value=""
                  options={[{ value: '', label: 'Add action…' }, ...missing.map((kind) => ({ value: kind, label: cardMeta(kind).label }))]}
                  onChange={(kind) => kind && props.onAdd(kind as SiteRuleActionKind, rule.id)}
                  className="w-44"
                />
              </div>
            )}
          </Group>
        );
      })}
    </div>
  );
}

export function Rules() {
  const { markSaved } = useSettings();
  const [rules, setRules] = useState<SiteRule[]>([]);
  const [drafts, setDrafts] = useState<DraftAction[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [context, setContext] = useState<SiteRulesContext>(EMPTY_CONTEXT);
  const [view, setView] = useState<View>(storedView);
  const [error, setError] = useState<string | null>(null);
  const [focusRuleId, setFocusRuleId] = useState<string | null>(null);
  const loaded = useRef(false);
  const saveSeq = useRef(0);

  useEffect(() => {
    if (!hasBridge()) return;
    let alive = true;
    const api = velaPages();
    void Promise.all([api.siteRules.list(), api.listSpaces(), api.siteRules.context(), api.siteRules.draft()]).then(
      ([stored, spaceList, nextContext, draft]) => {
        if (!alive) return;
        setSpaces(spaceList.filter((space) => !space.ephemeral));
        setContext(nextContext);
        let next = stored;
        if (draft && !stored.some((rule) => rule.pattern === draft.pattern)) {
          const rule: SiteRule = { id: newId(), pattern: draft.pattern, enabled: true, actions: [] };
          next = [...stored, rule];
          setFocusRuleId(rule.id);
        } else if (draft) {
          setFocusRuleId(stored.find((rule) => rule.pattern === draft.pattern)?.id ?? null);
        }
        loaded.current = true;
        setRules(next);
      },
      (reason) => alive && setError(errorText(reason, 'Tarnel could not read your rules.')),
    );
    return () => {
      alive = false;
    };
  }, []);

  const invalid = useMemo(() => new Set(rules.filter((rule) => !normalizeSitePattern(rule.pattern)).map((rule) => rule.id)), [rules]);

  const persist = useCallback(
    (next: SiteRule[]) => {
      setRules(next);
      if (!loaded.current || !hasBridge()) return;
      const seq = ++saveSeq.current;
      const valid = next.filter((rule) => normalizeSitePattern(rule.pattern));
      velaPages()
        .siteRules.save(valid)
        .then(
          () => {
            if (seq !== saveSeq.current) return;
            setError(null);
            markSaved();
          },
          (reason) => seq === saveSeq.current && setError(errorText(reason, 'Tarnel could not save your rules.')),
        );
    },
    [markSaved],
  );

  const updateRule = (ruleId: string, fn: (rule: SiteRule) => SiteRule) => persist(rules.map((rule) => (rule.id === ruleId ? fn(rule) : rule)));

  const onAdd = (kind: RuleCardKind, ruleId: string | null) => {
    if (kind === 'domain') {
      const rule: SiteRule = { id: newId(), pattern: '', enabled: true, actions: [] };
      setFocusRuleId(rule.id);
      persist([...rules, rule]);
      return;
    }
    const action = defaultAction(kind, spaces, context);
    if (ruleId) {
      updateRule(ruleId, (rule) => withAction(rule, action));
      return;
    }
    setDrafts((current) => [...current, { id: newId(), action }]);
  };

  const onPattern = (ruleId: string, raw: string) => {
    const pattern = normalizeSitePattern(raw) ?? raw.trim();
    updateRule(ruleId, (rule) => (rule.pattern === pattern ? rule : { ...rule, pattern }));
  };

  const onActionChange = (ruleId: string | null, key: string, action: SiteRuleAction) => {
    if (ruleId) updateRule(ruleId, (rule) => ({ ...rule, actions: rule.actions.map((entry) => (entry.kind === key ? action : entry)) }));
    else setDrafts((current) => current.map((draft) => (draft.id === key ? { ...draft, action } : draft)));
  };

  const onRemoveAction = (ruleId: string | null, key: string) => {
    if (ruleId) updateRule(ruleId, (rule) => ({ ...rule, actions: rule.actions.filter((entry) => entry.kind !== key) }));
    else setDrafts((current) => current.filter((draft) => draft.id !== key));
  };

  const onConnect = (fromRuleId: string | null, key: string, toRuleId: string | null) => {
    if (fromRuleId === toRuleId) return;
    const action = fromRuleId ? rules.find((rule) => rule.id === fromRuleId)?.actions.find((entry) => entry.kind === key) : drafts.find((draft) => draft.id === key)?.action;
    if (!action) return;
    if (!fromRuleId) setDrafts((current) => current.filter((draft) => draft.id !== key));
    if (!toRuleId) setDrafts((current) => [...current, { id: newId(), action }]);
    persist(
      rules.map((rule) => {
        if (rule.id === fromRuleId) return { ...rule, actions: rule.actions.filter((entry) => entry.kind !== key) };
        if (rule.id === toRuleId) return withAction(rule, action);
        return rule;
      }),
    );
  };

  const changeView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* per-page convenience only */
    }
  };

  const shared = {
    rules,
    spaces,
    context,
    invalid,
    focusRuleId,
    onAdd,
    onPattern,
    onToggle: (ruleId: string, enabled: boolean) => updateRule(ruleId, (rule) => ({ ...rule, enabled })),
    onRemoveRule: (ruleId: string) => persist(rules.filter((rule) => rule.id !== ruleId)),
    onActionChange,
    onRemoveAction,
  };

  return (
    <>
      <SectionHeader title="Rules" description="Per-site rules: when a tab opens a matching site, Tarnel applies the connected actions. Rules beat Space settings, which beat global settings." />
      <Tester rules={rules} spaces={spaces} />
      <motion.div variants={rise} className="mb-3 flex items-center justify-between gap-3">
        <Segmented<View>
          label="Rules view"
          value={view}
          onChange={changeView}
          options={[
            { value: 'workflow', label: 'Workflow', icon: Workflow },
            { value: 'list', label: 'List view', icon: List },
          ]}
        />
        {view === 'list' && (
          <Button type="button" variant="outline" size="sm" onClick={() => onAdd('domain', null)}>
            <Plus strokeWidth={1.75} aria-hidden />
            Add rule
          </Button>
        )}
      </motion.div>
      {error && (
        <p role="alert" className="mb-3 px-1 text-[12px] text-destructive">
          {error}
        </p>
      )}
      <motion.div variants={rise}>
        {view === 'workflow' ? <RuleCanvas {...shared} drafts={drafts} onConnect={onConnect} /> : <ListView {...shared} />}
      </motion.div>
      <p className="mt-4 px-1 text-[12px] leading-5 text-muted-foreground">
        Patterns: <code className="font-mono">example.com</code> (exactly), <code className="font-mono">*.example.com</code> (with subdomains),{' '}
        <code className="font-mono">shop-*.example.*</code> (wildcards). The most specific rule wins per action.
      </p>
    </>
  );
}
