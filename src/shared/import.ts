/**
 * Import from other browsers (Settings → Import). Profiles are referred to by an opaque id; file paths,
 * and above all passwords, stay in the main process. Password CSVs are read and parsed in main and only
 * a count goes back to the page.
 */
import type { SpaceId } from './types';

export type BrowserKind = 'chrome' | 'edge' | 'brave' | 'vivaldi' | 'opera' | 'chromium' | 'firefox';

export interface BrowserProfile {
  /** Opaque id, e.g. "chrome:Profile 1". */
  id: string;
  browser: BrowserKind;
  /** "Google Chrome", "Firefox", … */
  browserName: string;
  /** The profile's display name ("Person 1", "default-release", …). */
  profileName: string;
  hasBookmarks: boolean;
  hasHistory: boolean;
}

export type ImportKind = 'bookmarks' | 'history';

export interface PasswordCsvPreview {
  /** Hands the parsed file (kept in main) to `importPasswords`. */
  token: string;
  fileName: string;
  /** Detected exporter, e.g. "Chrome / Edge / Brave", "Firefox", "Bitwarden", "1Password". */
  format: string;
  /** Logins ready to import. */
  count: number;
  /** Rows without a usable URL or password. */
  skipped: number;
}

export interface PasswordImportResult {
  added: number;
  updated: number;
  skipped: number;
}

export const IMPORT_IPC = {
  profiles: 'pages:import-profiles',
  run: 'pages:import-run',
  pickPasswordCsv: 'pages:import-pick-password-csv',
  importPasswords: 'pages:import-passwords',
  discardPasswords: 'pages:import-discard-passwords',
  hint: 'pages:import-hint',
  dismissHint: 'pages:import-dismiss-hint',
} as const;

/** Bookmarks and history imported per run: at most this many history entries from the last 90 days. */
export const HISTORY_IMPORT_DAYS = 90;
export const HISTORY_IMPORT_LIMIT = 5000;

declare module './ipc' {
  interface VelaPagesAPI {
    browserImport: {
      /** Installed browsers' profiles on this device. */
      profiles(): Promise<BrowserProfile[]>;
      /** Imports one kind from a profile; resolves with how many entries were imported. */
      run(profileId: string, kind: ImportKind, spaceId: SpaceId): Promise<number>;
      /** Native file picker + parse in main; null when cancelled. */
      pickPasswordCsv(): Promise<PasswordCsvPreview | null>;
      importPasswords(token: string, spaceId: SpaceId): Promise<PasswordImportResult>;
      discardPasswords(token: string): Promise<void>;
      /** New tab hint: the browser to suggest, or null when dismissed / nothing to import. */
      hint(): Promise<{ browserName: string } | null>;
      dismissHint(): Promise<void>;
    };
  }
}
