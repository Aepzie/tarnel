import type { MixerRouting } from '@shared/audio-mixer';

export interface RoutingNote {
  /** Channel strip wording. */
  short: string;
  /** Detail pane wording. */
  long: string;
  /** warn = something does not fully apply; quiet = plain status. */
  tone: 'warn' | 'quiet';
  reload: boolean;
}

/** What a channel says about its processing; null = nothing to say (playing and processed, or untouched). */
export function routingNote(routing: MixerRouting, audible: boolean): RoutingNote | null {
  if (routing === 'partial') {
    return { short: 'Volume only', long: 'Some audio on this page can only be adjusted in volume', tone: 'warn', reload: false };
  }
  if (routing === 'reload') {
    return { short: 'Reload to apply', long: 'This sound started before the mixer · reload to apply', tone: 'warn', reload: true };
  }
  if (audible) return null;
  return { short: 'No sound yet', long: 'No sound yet · changes apply once it plays', tone: 'quiet', reload: false };
}
