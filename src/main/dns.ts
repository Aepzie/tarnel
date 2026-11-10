import { app } from 'electron';
import { resolveSecureDns, type HostResolverPlan } from '../shared/doh';
import { getSettings, onSettingsChanged } from './settings';

/**
 * DNS-over-HTTPS. app.configureHostResolver is process-global (one network service for every
 * session), so the setting applies to all Spaces at once. It may be called again at any time after
 * 'ready' and takes effect for new lookups immediately. Spaces routed through a proxy (MantelVPN,
 * SOCKS5, HTTP) hand the hostname to the proxy, which resolves it; DoH does not apply there.
 */

let applied: string | null = null;

function apply(plan: HostResolverPlan): void {
  const key = JSON.stringify(plan);
  if (key === applied) return;
  // Leave Chromium's defaults alone until the user turns DoH on for the first time.
  if (applied === null && plan.secureDnsMode === 'off') {
    applied = key;
    return;
  }
  try {
    app.configureHostResolver(plan);
    applied = key;
  } catch (error) {
    console.error('[dns] configureHostResolver failed', error);
  }
}

/** Call after app 'ready'. */
export function initSecureDns(): void {
  apply(resolveSecureDns(getSettings()));
  onSettingsChanged((settings) => apply(resolveSecureDns(settings)));
}
