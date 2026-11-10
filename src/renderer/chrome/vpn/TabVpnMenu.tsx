import { CheckIcon, LogInIcon, ShieldIcon } from 'lucide-react';
import type { TabState } from '@shared/types';
import { countriesOf } from '@shared/vpn-route';
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { vela } from '@/lib/vela';
import { MENU_ITEM, MENU_SEPARATOR, MENU_SURFACE } from '../tabs/menu-style';
import { Flag } from './Flag';
import { countryName } from './TabFlag';
import { useVpn, vpn } from './vpn-store';

function route(tab: TabState, country: string | null): void {
  void vela()
    .vpn.routeTab(tab.id, country)
    .then((result) => {
      if (!result.ok) vpn.open();
    }, () => undefined);
}

/** "MantelVPN ›" in the tab menu: route just this tab through a country (own cookies while routed), or Off. */
export function TabVpnMenu({ tab }: { tab: TabState }) {
  const state = useVpn();
  const live = state.mode === 'live';
  const countries = live ? countriesOf(state.servers) : [];
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className={`${MENU_ITEM} [&>svg:last-child]:size-3.5`}>
        {tab.vpn ? <Flag code={tab.vpn} className="-ml-0.5" /> : <ShieldIcon strokeWidth={1.75} />}
        MantelVPN
        {tab.vpn && <span className="ml-auto pl-3 text-[11px] text-muted-foreground">{tab.vpn.toUpperCase()}</span>}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className={`${MENU_SURFACE} max-h-[60vh] min-w-52 overflow-y-auto`}>
        {!live && !tab.vpn ? (
          <ContextMenuItem className={MENU_ITEM} onSelect={() => vpn.open()}>
            <LogInIcon strokeWidth={1.75} />
            Sign in to MantelVPN…
          </ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem className={MENU_ITEM} onSelect={() => route(tab, null)}>
              <span className="inline-grid w-5 place-items-center">{!tab.vpn && <CheckIcon className="size-3.5" strokeWidth={2} />}</span>
              Off
            </ContextMenuItem>
            {!live && (
              <ContextMenuItem className={MENU_ITEM} onSelect={() => vpn.open()}>
                <LogInIcon strokeWidth={1.75} />
                Sign in to MantelVPN…
              </ContextMenuItem>
            )}
            {countries.length > 0 && <ContextMenuSeparator className={MENU_SEPARATOR} />}
            {countries.map((country) => (
              <ContextMenuItem
                key={country.code}
                className={MENU_ITEM}
                disabled={!country.available && tab.vpn !== country.code}
                onSelect={() => route(tab, country.code)}
              >
                <Flag code={country.code} />
                <span className="truncate">{country.name || countryName(country.code)}</span>
                {tab.vpn === country.code && <CheckIcon className="ml-auto size-3.5" strokeWidth={2} />}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator className={MENU_SEPARATOR} />
            <ContextMenuLabel className="max-w-56 px-2 py-1 text-[11px] leading-snug font-normal text-muted-foreground">
              A routed tab keeps its own cookies and logins for that country.
            </ContextMenuLabel>
          </>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
