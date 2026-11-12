import { motion } from 'motion/react';
import { Check, Puzzle, RotateCw, ShieldAlert } from 'lucide-react';
import type { ExtensionPermission, ExtensionReview, PermissionRisk } from '@shared/types';
import { cn } from '@/lib/utils';
import { ease, spring } from '@/lib/motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** Extension UI shared by Settings → Extensions and tarnel://extensions. */

export const cardClass =
  'overflow-hidden rounded-xl bg-card/50 ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]';

export const cardMotion = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: spring.soft },
  exit: { opacity: 0, scale: 0.97, filter: 'blur(4px)', transition: { duration: 0.16, ease: ease.out } },
};

const RISK_DOT: Record<PermissionRisk, string> = {
  high: 'bg-destructive',
  medium: 'bg-amber-500',
  low: 'bg-muted-foreground/40',
};

const RISK_LABEL: Record<PermissionRisk, string> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' };

export function PermissionList({ permissions }: { permissions: ExtensionPermission[] }) {
  if (permissions.length === 0) {
    return <p className="text-xs leading-5 text-muted-foreground">No special permissions.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {permissions.map((permission) => (
        <li key={permission.id} className="flex items-start gap-2 text-xs leading-5">
          <span aria-hidden className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', RISK_DOT[permission.risk])} />
          <span className="min-w-0 flex-1">{permission.label}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{RISK_LABEL[permission.risk]}</span>
        </li>
      ))}
    </ul>
  );
}

export function HighRiskBadge({ risk }: { risk: PermissionRisk }) {
  if (risk !== 'high') return null;
  return (
    <Badge variant="outline" title="Can read or control a lot of what you do" className="shrink-0 gap-1 text-[10.5px] text-destructive">
      <ShieldAlert className="size-3" strokeWidth={2} aria-hidden />
      High access
    </Badge>
  );
}

export function ExtensionIcon({ extension, muted }: { extension: { icon: string | null }; muted: boolean }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-muted ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]">
      {extension.icon ? (
        <img
          src={extension.icon}
          alt=""
          draggable={false}
          className={cn('size-5 object-contain transition-[filter,opacity] duration-200', muted && 'opacity-50 grayscale')}
        />
      ) : (
        <Puzzle className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      )}
    </span>
  );
}

export function ReviewCard({
  review,
  busy,
  onConfirm,
  onCancel,
}: {
  review: ExtensionReview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const verb = review.update ? 'Reload' : 'Add';
  return (
    <motion.section {...cardMotion} aria-label={`Review ${review.name}`} className={cn(cardClass, 'mb-6')}>
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <ExtensionIcon extension={review} muted={false} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] leading-6 font-semibold tracking-tight">
              {verb} “{review.name}”?
            </h2>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{review.version}</span>
            <HighRiskBadge risk={review.risk} />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {review.source === 'store' ? 'From the Chrome Web Store.' : 'Unpacked folder.'} It will be able to:
          </p>
        </div>
      </header>
      <div className="px-4 pb-4">
        <PermissionList permissions={review.permissions} />
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-2 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy} className="h-8 rounded-lg px-3 text-xs active:scale-[0.96]">
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onConfirm} disabled={busy} autoFocus className="h-8 gap-1.5 rounded-lg px-3 text-xs active:scale-[0.96]">
          {busy ? <RotateCw className="size-3.5 motion-safe:animate-spin" strokeWidth={2} aria-hidden /> : <Check className="size-3.5" strokeWidth={2} aria-hidden />}
          {busy ? 'Adding…' : `${verb} extension`}
        </Button>
      </footer>
    </motion.section>
  );
}
