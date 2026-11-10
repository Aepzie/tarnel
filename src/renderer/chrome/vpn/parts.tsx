import { ChevronLeftIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { vpn, type VpnStatus, type VpnView } from './vpn-store';

/** off = muted, connecting = pulsing amber, connected = green with a soft halo. */
export function StatusDot({ status, className }: { status: VpnStatus; className?: string }) {
  return (
    <span aria-hidden className={cn('relative grid size-1.5 shrink-0 place-items-center', className)}>
      {status === 'connecting' && <span className="absolute -inset-0.5 animate-ping rounded-full bg-amber-400/70" />}
      {status === 'connected' && <span className="absolute -inset-[3px] rounded-full bg-emerald-400/25" />}
      <span
        className={cn(
          'relative size-1.5 rounded-full transition-colors duration-200',
          status === 'off' && 'bg-foreground/25',
          status === 'connecting' && 'bg-amber-400',
          status === 'connected' && 'bg-emerald-400 light:bg-emerald-500',
        )}
      />
    </span>
  );
}

/** Placeholder MantelVPN mark (two nested mantle arcs) until the partner supplies artwork. */
export function MantelMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('vpn-mark grid size-8 shrink-0 place-items-center rounded-[9px]', className)}>
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
        <path d="M5 18V11a7 7 0 0 1 14 0v7" />
        <path d="M9.5 18v-6a2.5 2.5 0 0 1 5 0v6" opacity={0.75} />
      </svg>
    </span>
  );
}

export function PreviewChip() {
  return (
    <span
      title="Preview: no VPN connection is made. Real provider integration comes in a later version."
      className="rounded-full bg-foreground/[0.06] px-1.5 py-px text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
    >
      Preview
    </span>
  );
}

export function BackButton({ label, to }: { label: string; to: VpnView }) {
  return (
    <button
      type="button"
      onClick={() => vpn.setView(to)}
      aria-label={`Back to ${label}`}
      className="-ml-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94]"
    >
      <ChevronLeftIcon className="size-4" strokeWidth={1.75} />
    </button>
  );
}
