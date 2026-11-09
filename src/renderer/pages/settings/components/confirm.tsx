import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ease } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { errorText } from '../store';

export interface ConfirmAction {
  id: string;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Question shown in the inline confirmation. */
  message: string;
  confirmLabel: string;
  /** Shown with an animated check after success. Omit when the owner unmounts on success. */
  successLabel?: string;
  run: () => Promise<void>;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; action: ConfirmAction }
  | { kind: 'done'; ok: boolean; text: string; actionId: string };

const swap = {
  initial: { opacity: 0, x: 6, filter: 'blur(2px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.18, ease: ease.out } },
  exit: { opacity: 0, x: -6, filter: 'blur(2px)', transition: { duration: 0.12, ease: ease.out } },
};

/** Animated check mark (circle + stroke draw). */
export function SuccessCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-4', className)} fill="none" aria-hidden>
      <motion.circle
        cx="8"
        cy="8"
        r="7"
        stroke="currentColor"
        strokeWidth="1.5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.36, ease: ease.out }}
      />
      <motion.path
        d="M5 8.25 7 10.25 11 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.24, delay: 0.22, ease: ease.out }}
      />
    </svg>
  );
}

/**
 * A row of action buttons where each destructive action asks for confirmation inline
 * (no dialogs). Escape or Cancel restores the buttons and returns focus to the trigger.
 */
export function ConfirmActions({ actions, className }: { actions: ConfirmAction[]; className?: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const focusAfterIdle = useRef<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const restore = (actionId: string) => {
    focusAfterIdle.current = actionId;
    setPhase({ kind: 'idle' });
  };

  useEffect(() => {
    if (phase.kind !== 'confirm') return;
    cancelButton.current?.focus();
    const node = strip.current;
    if (!node) return;
    const listeners = new AbortController();
    const actionId = phase.action.id;
    node.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        restore(actionId);
      },
      { signal: listeners.signal },
    );
    return () => listeners.abort();
  }, [phase]);

  useEffect(() => {
    if (phase.kind !== 'done') return;
    const timer = window.setTimeout(() => restore(phase.actionId), 2400);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const confirm = async (action: ConfirmAction) => {
    setBusy(true);
    try {
      await action.run();
      if (!alive.current) return;
      if (action.successLabel) setPhase({ kind: 'done', ok: true, text: action.successLabel, actionId: action.id });
      else restore(action.id);
    } catch (error) {
      if (!alive.current) return;
      setPhase({ kind: 'done', ok: false, text: errorText(error, 'Something went wrong'), actionId: action.id });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div ref={strip} className={cn('flex min-h-8 items-center justify-end', className)}>
      <AnimatePresence mode="wait" initial={false}>
        {phase.kind === 'idle' && (
          <motion.div key="idle" {...swap} className="flex items-center gap-1">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.id}
                  ref={(node) => {
                    if (!node || focusAfterIdle.current !== action.id) return;
                    focusAfterIdle.current = null;
                    if (!node.disabled) node.focus();
                  }}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={action.disabled}
                  title={action.disabled ? action.disabledReason : undefined}
                  onClick={() => setPhase({ kind: 'confirm', action })}
                  className={cn(
                    'h-8 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-[color,background-color,transform] duration-150 hover:text-foreground active:scale-[0.96]',
                    action.danger && 'hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/10',
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {action.label}
                </Button>
              );
            })}
          </motion.div>
        )}

        {phase.kind === 'confirm' && (
          <motion.div
            key="confirm"
            {...swap}
            role="group"
            aria-label={phase.action.message}
            className="flex items-center gap-2"
          >
            <span className="mr-1 text-xs text-muted-foreground">{phase.action.message}</span>
            <Button
              ref={cancelButton}
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => restore(phase.action.id)}
              className="h-8 rounded-lg px-2.5 text-xs active:scale-[0.96]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={phase.action.danger ? 'destructive' : 'secondary'}
              size="sm"
              disabled={busy}
              onClick={() => void confirm(phase.action)}
              className="h-8 rounded-lg px-3 text-xs active:scale-[0.96]"
            >
              {busy ? 'Working…' : phase.action.confirmLabel}
            </Button>
          </motion.div>
        )}

        {phase.kind === 'done' && (
          <motion.div
            key="done"
            {...swap}
            role="status"
            className={cn(
              'flex h-8 items-center gap-2 px-2.5 text-xs font-medium',
              phase.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive',
            )}
          >
            {phase.ok ? <SuccessCheck /> : <AlertCircle className="size-4" strokeWidth={1.75} aria-hidden />}
            {phase.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
