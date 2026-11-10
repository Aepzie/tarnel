import type { TabState } from '@shared/types';
import { cn } from '@/lib/utils';
import { flagUrl } from './flags';

let regionNames: Intl.DisplayNames | null = null;

/** English country name for an ISO code ("nl" → "Netherlands"). */
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** "Via MantelVPN · Netherlands" for a routed tab, else null. */
export function vpnTabLabel(tab: TabState): string | null {
  return tab.vpn ? `Via MantelVPN · ${countryName(tab.vpn)}` : null;
}

/** Appends the routing line to a tab tooltip. */
export function withVpnLabel(label: string, tab: TabState): string {
  const vpn = vpnTabLabel(tab);
  return vpn ? `${label}\n${vpn}` : label;
}

/**
 * The routed country's flag behind a tab: anchored left, faded out towards the right and kept faint
 * so favicon and title stay readable. Renders nothing for unrouted tabs.
 */
export function TabFlag({ tab, className }: { tab: TabState; className?: string }) {
  if (!tab.vpn) return null;
  const url = flagUrl(tab.vpn);
  return (
    <span
      aria-hidden
      data-vpn-flag={tab.vpn}
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden rounded-[10px] bg-[length:7rem_100%] bg-left bg-no-repeat opacity-30 light:opacity-35',
        '[mask-image:linear-gradient(to_right,#000_0,rgb(0_0_0/0.6)_3rem,transparent_7rem)]',
        !url && 'bg-foreground/10',
        className,
      )}
      style={url ? { backgroundImage: `url("${url}")` } : undefined}
    />
  );
}
