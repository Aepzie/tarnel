import { ipcRenderer } from 'electron';
import { HIGH_ENTROPY_HINTS, IDENTITY_HINTS_CHANNEL } from '../shared/identity';

interface UserAgentData {
  getHighEntropyValues(hints: readonly string[]): Promise<unknown>;
}

/**
 * Sends this renderer's real UA client hints to main (identity/headers.ts), which mirrors them into
 * the Sec-CH-UA* headers Electron's network stack leaves out. Read from the preload's isolated
 * world, so a strict Space's main-world reduction never feeds back into the source values.
 */
export function reportIdentityHints(): void {
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  uaData
    ?.getHighEntropyValues(HIGH_ENTROPY_HINTS)
    .then((values) => ipcRenderer.send(IDENTITY_HINTS_CHANNEL, values))
    .catch(() => undefined);
}
