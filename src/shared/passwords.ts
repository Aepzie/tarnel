/**
 * Password manager contract shared by the password store (src/main/passwords), the browser-import feature and the UI.
 * Credentials belong to a Space. Passwords never leave the main process except to fill a form the user picked
 * or to be revealed after the user asked for it.
 */
import type { SpaceId } from './types';
import type { AliasRef } from './aliases';

/** What the UI may see about a saved login (no password). */
export interface SavedLogin {
  id: string;
  spaceId: SpaceId;
  /** Scheme + host (+ port), e.g. "https://accounts.example.com". */
  origin: string;
  username: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** Email alias created by Tarnel for this login (see src/main/aliases). */
  alias?: AliasRef;
}

/** A login read from another browser or a CSV export, before it is stored. */
export interface ImportedLogin {
  /** Any URL of the site; the store normalises it to an origin. */
  url: string;
  username: string;
  password: string;
}

/** Password manager channels. chrome:* only from the chrome UI; pages:* only from tarnel://passwords; frame:* from tab frames (session preload). */
export const PASSWORD_IPC = {
  answerSave: 'chrome:password-answer-save',
  fill: 'chrome:password-fill',
  dismissOffer: 'chrome:password-dismiss-offer',
  savePrompt: 'chrome-event:password-save',
  saveCancel: 'chrome-event:password-save-cancel',
  fillOffer: 'chrome-event:password-offer',
  fillCancel: 'chrome-event:password-offer-cancel',
  status: 'pages:passwords-status',
  list: 'pages:passwords-list',
  reveal: 'pages:passwords-reveal',
  copy: 'pages:passwords-copy',
  update: 'pages:passwords-update',
  remove: 'pages:passwords-remove',
  exportCsv: 'pages:passwords-export',
  neverRemove: 'pages:passwords-never-remove',
  frameFlags: 'frame:passwords-flags',
  frameFormSeen: 'frame:passwords-form-seen',
  frameCaptured: 'frame:passwords-captured',
  frameFill: 'frame:passwords-fill',
} as const;

/** Chrome UI: "Save password for example.com?" (no password inside). */
export interface PasswordSavePrompt {
  id: string;
  tabId: number;
  host: string;
  username: string;
  /** 'update' when the username is already saved with a different password. */
  kind: 'save' | 'update';
  burner: boolean;
}

export type PasswordSaveAnswer = 'save' | 'never' | 'dismiss';

/** Chrome UI: saved accounts offered for the login form of a tab (no passwords). */
export interface PasswordFillOffer {
  id: string;
  tabId: number;
  host: string;
  /** Plain http:// page: filling still needs the click, and the card warns. */
  insecure: boolean;
  accounts: { id: string; username: string }[];
}

/** What the session preload may know about its frame (no logins). */
export interface PasswordFrameFlags {
  save: boolean;
  fill: boolean;
  /** Offer email aliases on sign-up forms (a provider is set up). */
  alias?: boolean;
}

/** Captured from a submitted login form. Main derives the origin from the sending frame, never from this. */
export interface CapturedLogin {
  username: string;
  password: string;
}

export interface PasswordSpaceSummary {
  spaceId: SpaceId;
  name: string;
  color: string;
  burner: boolean;
  count: number;
  /** Origins the user answered "Never for this site" for. */
  never: string[];
}

export interface PasswordsStatus {
  /** OS encryption (DPAPI / Keychain / a real Linux keyring) is usable; without it nothing is saved. */
  encryption: boolean;
  spaces: PasswordSpaceSummary[];
}

export interface SavedLoginPatch {
  username?: string;
  password?: string;
}
