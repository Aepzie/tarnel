/**
 * Password manager contract shared by the password store (src/main/passwords), the browser-import feature and the UI.
 * Credentials belong to a Space. Passwords never leave the main process except to fill a form the user picked
 * or to be revealed after the user asked for it.
 */
import type { SpaceId } from './types';

/** What the UI may see about a saved login (no password). */
export interface SavedLogin {
  id: string;
  spaceId: SpaceId;
  /** Scheme + host (+ port), e.g. "https://accounts.example.com". */
  origin: string;
  username: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** A login read from another browser or a CSV export, before it is stored. */
export interface ImportedLogin {
  /** Any URL of the site; the store normalises it to an origin. */
  url: string;
  username: string;
  password: string;
}
