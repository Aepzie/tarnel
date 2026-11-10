import { useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldIcon } from 'lucide-react';
import type { UICommand } from '@shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCommand, useSettings } from '@/hooks/browser';
import { useOverlayPresence } from '@/hooks/overlay';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ui } from '../ui-store';
import { serverIn } from './vpn-data';
import { VpnPanel } from './VpnPanel';
import { StatusDot } from './parts';
import { useVpn, vpn, type VpnStatus } from './vpn-store';

const STATUS_LABEL: Record<VpnStatus, string> = { off: 'off', connecting: 'connecting', connected: 'connected' };

/** Island pill opening the VPN preview popover (also from the palette). Mock only, see vpn-store. */
export function VpnButton() {
  const state = useVpn();
  const { autoHideToolbar } = useSettings();
  const contentRef = useRef<HTMLDivElement>(null);
  useOverlayPresence(state.open);

  useEffect(() => {
    if (state.open && autoHideToolbar) ui.setIslandRevealed(true);
  }, [state.open, autoHideToolbar]);

  const onCommand = useCallback((command: UICommand): void => {
    if (command === 'escape') vpn.close();
  }, []);
  useCommand(onCommand);

  const server = state.status === 'connected' ? serverIn(state.servers, state.activeServerId) : undefined;

  return (
    <Popover open={state.open} onOpenChange={vpn.setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`VPN, ${STATUS_LABEL[state.status]}${server ? `, ${server.city}` : ''}`}
          title="VPN (MantelVPN)"
          className={cn(
            'no-drag relative flex h-7 shrink-0 items-center gap-1.5 rounded-[10px] pr-2 pl-1.5 text-muted-foreground transition-[background-color,color] duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]',
            (state.open || state.status !== 'off') && 'text-foreground',
            state.open && 'bg-accent',
          )}
        >
          <ShieldIcon className="size-[15px]" strokeWidth={1.75} />
          <span className="text-[12px] font-medium tracking-tight">VPN</span>
          <StatusDot status={state.status} />
          <AnimatePresence initial={false}>
            {server && (
              <motion.span
                key="cc"
                className="overflow-hidden font-mono text-[10.5px] font-medium text-emerald-500 dark:text-emerald-400"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={spring.snappy}
              >
                {server.countryCode}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        sideOffset={10}
        collisionPadding={8}
        aria-label="VPN"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        className="w-[364px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border-0 bg-popover p-0 outline-none shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_24px_64px_-12px_rgb(0_0_0/0.55)] backdrop-blur-2xl backdrop-saturate-150 light:shadow-[0_0_0_1px_var(--island-ring),inset_0_1px_0_var(--island-highlight),0_20px_48px_-16px_rgb(0_0_0/0.25)]"
      >
        <VpnPanel />
      </PopoverContent>
    </Popover>
  );
}
