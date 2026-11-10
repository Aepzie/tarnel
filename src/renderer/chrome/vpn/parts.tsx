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

/** Official MantelVPN mark (mantelvpn.com/icon.svg, copy in ./assets/mantel.svg), inlined. */
export function MantelMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn('vpn-mark size-8 shrink-0', className)}>
      <rect width="24" height="24" rx="7" fill="#18181b" />
      <path d="M7 16.5V8.2c0-.5.6-.8 1-.4l4 3.7 4-3.7c.4-.4 1-.1 1 .4v8.3" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="16.6" r="1.4" fill="#089868" />
    </svg>
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
