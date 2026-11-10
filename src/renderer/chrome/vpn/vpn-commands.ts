import { ShieldIcon } from 'lucide-react';
import type { PaletteCommand } from '../palette/commands';
import { vpn } from './vpn-store';

export function vpnCommands(): PaletteCommand[] {
  return [
    {
      id: 'cmd:vpn',
      title: 'VPN',
      icon: ShieldIcon,
      keywords: 'vpn mantelvpn mantel mullvad proton privacy location server account connect',
      hint: 'MantelVPN',
      run: () => window.setTimeout(vpn.open, 0),
    },
  ];
}
