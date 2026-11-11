/**
 * Email aliases contract (src/main/aliases). Main talks to the alias provider; the API key never
 * leaves main. Renderers only see the provider, the account's display email/plan and created aliases.
 */

export type AliasProviderId = 'simplelogin' | 'addy';
/** words / chars: random local part; site: based on the site's name (custom alias). */
export type AliasStyle = 'words' | 'chars' | 'site';

export const ALIAS_PROVIDERS: readonly { id: AliasProviderId; label: string; manageUrl: string }[] = [
  { id: 'simplelogin', label: 'SimpleLogin', manageUrl: 'https://app.simplelogin.io/dashboard/' },
  { id: 'addy', label: 'addy.io', manageUrl: 'https://app.addy.io/aliases' },
];

export function aliasProviderLabel(id: AliasProviderId): string {
  return ALIAS_PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}

export function aliasManageUrl(id: AliasProviderId): string {
  return ALIAS_PROVIDERS.find((provider) => provider.id === id)?.manageUrl ?? '';
}

/** An alias remembered with a saved login. */
export interface AliasRef {
  provider: AliasProviderId;
  /** Provider's alias id (for the manage link). */
  id: string;
  email: string;
}

export interface AliasAccount {
  /** Account email (SimpleLogin) or username (addy.io). */
  name: string;
  plan: string;
}

export interface AliasChoice {
  id: string;
  label: string;
}

/** What vela://settings sees. Never contains the API key. */
export interface AliasSettingsView {
  provider: AliasProviderId | null;
  hasKey: boolean;
  style: AliasStyle;
  /** addy.io alias domain; null = account default. */
  domain: string | null;
  /** SimpleLogin mailbox id / addy.io recipient id; null = account default. */
  mailbox: string | null;
  account: AliasAccount | null;
  encryption: boolean;
}

export interface AliasSettingsPatch {
  provider?: AliasProviderId | null;
  style?: AliasStyle;
  domain?: string | null;
  mailbox?: string | null;
}

export interface AliasOptions {
  domains: AliasChoice[];
  mailboxes: AliasChoice[];
}

/** Chrome UI: "Use an alias for example.com?" */
export interface AliasOffer {
  id: string;
  tabId: number;
  /** Registrable domain the alias is created for. */
  site: string;
  provider: AliasProviderId;
}

export const ALIAS_IPC = {
  get: 'pages:aliases-get',
  set: 'pages:aliases-set',
  setKey: 'pages:aliases-set-key',
  options: 'pages:aliases-options',
  create: 'chrome:alias-create',
  dismiss: 'chrome:alias-dismiss',
  offer: 'chrome-event:alias-offer',
  offerCancel: 'chrome-event:alias-offer-cancel',
  frameFieldSeen: 'frame:alias-field-seen',
  frameFill: 'frame:alias-fill',
} as const;
