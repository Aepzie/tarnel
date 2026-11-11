import { useCallback, useLayoutEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { Space } from '@shared/types';
import type { SiteRule, SiteRuleAction, SiteRulesContext } from '@shared/site-rules';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { RegionSelect } from '@/chrome/spaces/FingerprintPicker';
import { ActionFields, RULE_CARDS, cardMeta, type RuleCardKind } from './rule-actions';

/**
 * Workflow view of the site rules: a palette of card types, domain cards on the left and the action
 * cards each one is wired to on the right, connected by SVG curves. Everything a pointer can do has a
 * keyboard path too: palette items add on Enter, each action card has a "Connected to" select.
 */

export interface DraftAction {
  id: string;
  action: SiteRuleAction;
}

/** A card the pointer can connect: a domain (rule) or an action (connected or draft). */
type NodeRef = { type: 'domain'; ruleId: string } | { type: 'action'; ruleId: string | null; key: string };

interface RuleCanvasProps {
  rules: readonly SiteRule[];
  drafts: readonly DraftAction[];
  spaces: readonly Space[];
  context: SiteRulesContext;
  invalid: ReadonlySet<string>;
  focusRuleId: string | null;
  onAdd: (kind: RuleCardKind, ruleId: string | null) => void;
  onPattern: (ruleId: string, pattern: string) => void;
  onToggle: (ruleId: string, enabled: boolean) => void;
  onRemoveRule: (ruleId: string) => void;
  onActionChange: (ruleId: string | null, key: string, action: SiteRuleAction) => void;
  onRemoveAction: (ruleId: string | null, key: string) => void;
  /** Moves an action (by rule + kind, or draft id) onto a rule, or off every rule (null). */
  onConnect: (fromRuleId: string | null, key: string, toRuleId: string | null) => void;
}

const DRAG_TYPE = 'application/x-vela-rule-card';

interface Line {
  id: string;
  d: string;
  muted: boolean;
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(24, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function nodeAt(clientX: number, clientY: number): NodeRef | null {
  const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-rule-node]');
  if (!element) return null;
  const ruleId = element.dataset.ruleId || null;
  if (element.dataset.ruleNode === 'domain' && ruleId) return { type: 'domain', ruleId };
  if (element.dataset.ruleNode === 'action' && element.dataset.key) return { type: 'action', ruleId, key: element.dataset.key };
  return null;
}

function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <div {...rest} className={cn('relative rounded-xl bg-card ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]', className)}>
      {children}
    </div>
  );
}

function Port({ side, label, onPointerDown }: { side: 'left' | 'right'; label: string; onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title="Drag to connect"
      data-port={side}
      onPointerDown={onPointerDown}
      className={cn(
        'absolute top-1/2 z-10 size-3 -translate-y-1/2 cursor-crosshair rounded-full bg-background ring-1 ring-border transition-colors duration-150 hover:bg-space hover:ring-space',
        side === 'right' ? '-right-1.5' : '-left-1.5',
      )}
    />
  );
}

export function RuleCanvas(props: RuleCanvasProps) {
  const { rules, drafts, spaces, context, invalid, focusRuleId } = props;
  const canvas = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pending, setPending] = useState<{ from: NodeRef; x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const measure = useCallback(() => {
    const root = canvas.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const portOf = (selector: string): { x: number; y: number } | null => {
      const port = root.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      return port ? { x: port.left + port.width / 2 - box.left, y: port.top + port.height / 2 - box.top } : null;
    };
    const next: Line[] = [];
    for (const rule of rules) {
      const from = portOf(`[data-rule-node="domain"][data-rule-id="${rule.id}"] [data-port="right"]`);
      if (!from) continue;
      for (const action of rule.actions) {
        const to = portOf(`[data-rule-node="action"][data-rule-id="${rule.id}"][data-key="${action.kind}"] [data-port="left"]`);
        if (to) next.push({ id: `${rule.id}:${action.kind}`, d: curve(from.x, from.y, to.x, to.y), muted: !rule.enabled });
      }
    }
    setLines(next);
    setSize({ width: root.scrollWidth, height: root.scrollHeight });
  }, [rules]);

  useLayoutEffect(() => {
    measure();
  }, [measure, drafts]);

  useLayoutEffect(() => {
    const root = canvas.current;
    if (!root) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  const startConnect = (from: NodeRef) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    const root = canvas.current;
    if (!root || event.button !== 0) return;
    event.preventDefault();
    const box = root.getBoundingClientRect();
    const port = event.currentTarget.getBoundingClientRect();
    const x1 = port.left + port.width / 2 - box.left;
    const y1 = port.top + port.height / 2 - box.top;
    setPending({ from, x1, y1, x2: x1, y2: y1 });
    const move = (moveEvent: PointerEvent): void => {
      setPending((current) => current && { ...current, x2: moveEvent.clientX - box.left, y2: moveEvent.clientY - box.top });
    };
    const up = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPending(null);
      const target = nodeAt(upEvent.clientX, upEvent.clientY);
      if (!target) return;
      if (from.type === 'action' && target.type === 'domain') props.onConnect(from.ruleId, from.key, target.ruleId);
      if (from.type === 'domain' && target.type === 'action') props.onConnect(target.ruleId, target.key, from.ruleId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const kind = event.dataTransfer.getData(DRAG_TYPE) as RuleCardKind;
    setDropTarget(null);
    if (!RULE_CARDS.some((card) => card.kind === kind)) return;
    event.preventDefault();
    const target = nodeAt(event.clientX, event.clientY);
    props.onAdd(kind, kind !== 'domain' && target?.type === 'domain' ? target.ruleId : null);
  };

  const domainOptions = [
    { value: '', label: 'Not connected' },
    ...rules.map((rule) => ({ value: rule.id, label: rule.pattern || 'New domain' })),
  ];

  const actionCard = (ruleId: string | null, key: string, action: SiteRuleAction, dimmed: boolean) => {
    const meta = cardMeta(action.kind);
    const Icon = meta.icon;
    return (
      <Card
        key={`${ruleId ?? 'draft'}:${key}`}
        data-rule-node="action"
        data-rule-id={ruleId ?? ''}
        data-key={key}
        className={cn('p-3 transition-opacity duration-150', dimmed && 'opacity-60', !ruleId && 'border border-dashed border-border bg-card/60 ring-0')}
      >
        <Port side="left" label={`Connect ${meta.label}`} onPointerDown={startConnect({ type: 'action', ruleId, key })} />
        <div className="mb-2 flex items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <span className="flex-1 truncate text-[12px] font-medium">{meta.label}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${meta.label}`}
            onClick={() => props.onRemoveAction(ruleId, key)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Trash2 strokeWidth={1.75} aria-hidden />
          </Button>
        </div>
        <ActionFields action={action} spaces={spaces} context={context} onChange={(next) => props.onActionChange(ruleId, key, next)} />
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Connected to</span>
          <RegionSelect
            label={`${meta.label}: connected to`}
            value={ruleId ?? ''}
            options={domainOptions}
            onChange={(next) => props.onConnect(ruleId, key, next || null)}
            className="h-7 min-w-0 flex-1"
          />
        </div>
      </Card>
    );
  };

  return (
    <div className="flex gap-3">
      <div className="w-36 shrink-0" role="toolbar" aria-orientation="vertical" aria-label="Card types">
        <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Cards</p>
        <ul className="flex flex-col gap-1">
          {RULE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <li key={card.kind}>
                <button
                  type="button"
                  draggable
                  title={`${card.hint}. Drag onto the canvas, or press Enter to add.`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_TYPE, card.kind);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => props.onAdd(card.kind, null)}
                  className="flex h-8 w-full cursor-grab items-center gap-2 rounded-lg px-2 text-left text-[12px] text-muted-foreground ring-1 ring-transparent transition-colors duration-150 outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-ring/60 active:cursor-grabbing"
                >
                  <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="truncate">{card.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div
        ref={canvas}
        role="group"
        aria-label="Rules workflow"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          const target = nodeAt(event.clientX, event.clientY);
          setDropTarget(target?.type === 'domain' ? target.ruleId : 'canvas');
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
        }}
        onDrop={onDrop}
        className={cn(
          'relative min-h-72 min-w-0 flex-1 rounded-xl bg-muted/30 p-4 ring-1 ring-border transition-colors duration-150',
          dropTarget === 'canvas' && 'ring-space/60',
        )}
      >
        <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={size.width} height={size.height}>
          {lines.map((line) => (
            <path
              key={line.id}
              d={line.d}
              fill="none"
              strokeWidth={1.5}
              className={line.muted ? 'stroke-border' : 'stroke-[color-mix(in_oklab,var(--accent-space)_70%,transparent)]'}
            />
          ))}
          {pending && <path d={curve(pending.x1, pending.y1, pending.x2, pending.y2)} fill="none" strokeWidth={1.5} strokeDasharray="4 4" className="stroke-space" />}
        </svg>

        {rules.length === 0 && drafts.length === 0 && (
          <p className="grid h-64 place-items-center px-6 text-center text-[13px] text-muted-foreground">
            Drag a Domain card here, then connect actions to it.
          </p>
        )}

        <div className="relative flex flex-col gap-4">
          {rules.map((rule) => {
            const isInvalid = invalid.has(rule.id);
            return (
              <div key={rule.id} className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-start gap-x-12">
                <Card
                  data-rule-node="domain"
                  data-rule-id={rule.id}
                  className={cn('p-3 transition-[box-shadow,opacity] duration-150', !rule.enabled && 'opacity-60', dropTarget === rule.id && 'ring-space')}
                >
                  <Port side="right" label={`Connect actions to ${rule.pattern || 'this domain'}`} onPointerDown={startConnect({ type: 'domain', ruleId: rule.id })} />
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex-1 text-[11px] font-medium text-muted-foreground">Domain</span>
                    <Switch checked={rule.enabled} onCheckedChange={(enabled) => props.onToggle(rule.id, enabled)} aria-label={`Rule for ${rule.pattern || 'new domain'} enabled`} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete rule for ${rule.pattern || 'new domain'}`}
                      onClick={() => props.onRemoveRule(rule.id)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 strokeWidth={1.75} aria-hidden />
                    </Button>
                  </div>
                  <PatternInput rule={rule} invalid={isInvalid} autoFocus={focusRuleId === rule.id} onCommit={(pattern) => props.onPattern(rule.id, pattern)} />
                  {rule.actions.length === 0 && <p className="mt-2 text-[11px] text-muted-foreground">No actions yet.</p>}
                </Card>
                <div className="flex min-w-0 flex-col gap-2">
                  {rule.actions.map((action) => actionCard(rule.id, action.kind, action, !rule.enabled))}
                </div>
              </div>
            );
          })}

          {drafts.length > 0 && (
            <div className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-start gap-x-12">
              <p className="pt-3 text-[12px] leading-5 text-muted-foreground">Not connected yet: drag from a card's dot to a domain, or pick one below.</p>
              <div className="flex min-w-0 flex-col gap-2">{drafts.map((draft) => actionCard(null, draft.id, draft.action, false))}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PatternInput({ rule, invalid, autoFocus, onCommit }: { rule: SiteRule; invalid: boolean; autoFocus?: boolean; onCommit: (pattern: string) => void }) {
  const [text, setText] = useState(rule.pattern);
  useLayoutEffect(() => setText(rule.pattern), [rule.pattern]);
  return (
    <Input
      value={text}
      autoFocus={autoFocus}
      spellCheck={false}
      placeholder="*.example.com"
      aria-label="Domain pattern"
      aria-invalid={invalid || undefined}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(text);
      }}
      className="h-8 font-mono text-[12px]"
    />
  );
}
