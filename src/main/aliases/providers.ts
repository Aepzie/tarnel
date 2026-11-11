import type { AliasAccount, AliasChoice, AliasProviderId, AliasRef, AliasStyle } from '../../shared/aliases';
import { siteLabel } from '../../shared/alias-form';

/**
 * SimpleLogin and addy.io API shapes. Pure: builds requests and parses responses; the transport
 * (net.fetch with timeout, no redirects) is injected by index.ts. Unit-tested against the
 * documented response shapes.
 *
 * SimpleLogin (https://github.com/simple-login/app/blob/master/docs/api.md), header `Authentication: <key>`:
 *   GET  /api/user_info                       → { email, name, is_premium, in_trial, … }
 *   POST /api/alias/random/new?hostname=&mode=word|uuid  { note }  → 201 alias { id, email, … }
 *   GET  /api/v5/alias/options?hostname=      → { can_create, prefix_suggestion, suffixes: [{ suffix, signed_suffix, is_custom, is_premium }] }
 *   POST /api/v3/alias/custom/new?hostname=   { alias_prefix, signed_suffix, mailbox_ids, note } → 201 alias
 *   GET  /api/v2/mailboxes                    → { mailboxes: [{ id, email, default, verified }] }
 *   errors: 4xx { error }
 * addy.io (https://app.addy.io/docs/), headers `Authorization: Bearer <key>`, `X-Requested-With: XMLHttpRequest`:
 *   GET  /api/v1/account-details  → { data: { username, subscription, default_alias_domain, … } }
 *   POST /api/v1/aliases          { domain, description, format, local_part?, recipient_ids? } → 201 { data: { id, email, … } }
 *   GET  /api/v1/domain-options   → { data: string[], defaultAliasDomain }
 *   GET  /api/v1/recipients       → { data: [{ id, email, email_verified_at }] }
 *   errors: 4xx { message }
 */

export const DEFAULT_BASES: Record<AliasProviderId, string> = {
  simplelogin: 'https://app.simplelogin.io',
  addy: 'https://app.addy.io',
};

export const MAX_KEY = 512;
export const NOTE = 'Created by Vela';

export interface ApiRequest {
  method: 'GET' | 'POST';
  /** Path + query, appended to the base. */
  path: string;
  body?: Record<string, unknown>;
}

export interface ApiResponse {
  status: number;
  json: unknown;
}

export type Transport = (request: ApiRequest) => Promise<ApiResponse>;

export class AliasApiError extends Error {}

/**
 * The provider's base URL. A test override (VELA_ALIAS_API_BASE) is only accepted for loopback http(s)
 * origins, so it can never redirect a real API key to another host.
 */
export function apiBase(provider: AliasProviderId, override: string | undefined): string {
  if (!override) return DEFAULT_BASES[provider];
  try {
    const url = new URL(override);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    if (loopback && (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/' && !url.search && !url.username) return url.origin;
  } catch {
    /* fall through */
  }
  return DEFAULT_BASES[provider];
}

export function validKey(key: unknown): key is string {
  return typeof key === 'string' && key.length >= 8 && key.length <= MAX_KEY && /^[\x21-\x7e]+$/.test(key);
}

export function authHeaders(provider: AliasProviderId, key: string): Record<string, string> {
  const common = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (provider === 'simplelogin') return { ...common, Authentication: key };
  return { ...common, Authorization: `Bearer ${key}`, 'X-Requested-With': 'XMLHttpRequest' };
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown, max = 320): string => (typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
const EMAIL = /^[^\s@]{1,128}@[^\s@]{1,253}\.[^\s@]{1,63}$/;

function errorMessage(response: ApiResponse): string {
  const body = record(response.json);
  const message = text(body.error, 200) || text(body.message, 200);
  if (response.status === 401 || response.status === 403) return message || 'The API key was rejected.';
  if (response.status === 429) return 'Too many requests. Try again in a minute.';
  return message || `The provider answered with HTTP ${response.status}.`;
}

function ok(response: ApiResponse): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) throw new AliasApiError(errorMessage(response));
  return record(response.json);
}

export function parseAccount(provider: AliasProviderId, response: ApiResponse): AliasAccount {
  const body = ok(response);
  if (provider === 'simplelogin') {
    const name = text(body.email) || text(body.name);
    if (!name) throw new AliasApiError('Unexpected answer from SimpleLogin.');
    return { name, plan: body.is_premium === true ? (body.in_trial === true ? 'Premium (trial)' : 'Premium') : 'Free' };
  }
  const account = record(body.data);
  const name = text(account.username);
  if (!name) throw new AliasApiError('Unexpected answer from addy.io.');
  const plan = text(account.subscription, 40);
  return { name, plan: plan ? plan[0].toUpperCase() + plan.slice(1) : 'Free' };
}

export function parseAlias(provider: AliasProviderId, response: ApiResponse): AliasRef {
  const body = ok(response);
  const alias = provider === 'simplelogin' ? body : record(body.data);
  const email = text(alias.email).trim();
  const id = text(alias.id, 64);
  if (!EMAIL.test(email) || !id) throw new AliasApiError('The provider did not return an alias.');
  return { provider, id, email };
}

export function parseMailboxes(provider: AliasProviderId, response: ApiResponse): AliasChoice[] {
  const body = ok(response);
  const list = provider === 'simplelogin' ? body.mailboxes : body.data;
  if (!Array.isArray(list)) return [];
  return list
    .map(record)
    .filter((entry) => text(entry.id, 64) && text(entry.email))
    .filter((entry) => (provider === 'simplelogin' ? entry.verified !== false : entry.email_verified_at !== null))
    .slice(0, 100)
    .map((entry) => ({ id: text(entry.id, 64), label: text(entry.email) }));
}

export function parseDomains(response: ApiResponse): AliasChoice[] {
  const list = ok(response).data;
  if (!Array.isArray(list)) return [];
  return list.filter((domain): domain is string => typeof domain === 'string' && /^[a-z0-9.-]{1,253}$/i.test(domain)).slice(0, 100).map((domain) => ({ id: domain, label: domain }));
}

export interface SuffixChoice {
  prefix: string;
  signedSuffix: string;
}

/** First suffix the account may use; the prefix is the provider's suggestion or the site label. */
export function parseSuffix(response: ApiResponse, site: string): SuffixChoice {
  const body = ok(response);
  if (body.can_create === false) throw new AliasApiError('Your SimpleLogin plan cannot create more aliases.');
  const suffixes = Array.isArray(body.suffixes) ? body.suffixes.map(record) : [];
  const usable = suffixes.find((entry) => text(entry.signed_suffix, 1024) && entry.is_premium !== true) ?? suffixes.find((entry) => text(entry.signed_suffix, 1024));
  if (!usable) throw new AliasApiError('SimpleLogin offered no alias domain.');
  const suggestion = text(body.prefix_suggestion, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return { prefix: suggestion || siteLabel(site), signedSuffix: text(usable.signed_suffix, 1024) };
}

export const accountRequest = (provider: AliasProviderId): ApiRequest =>
  ({ method: 'GET', path: provider === 'simplelogin' ? '/api/user_info' : '/api/v1/account-details' });

export const mailboxesRequest = (provider: AliasProviderId): ApiRequest =>
  ({ method: 'GET', path: provider === 'simplelogin' ? '/api/v2/mailboxes' : '/api/v1/recipients' });

export const domainsRequest = (): ApiRequest => ({ method: 'GET', path: '/api/v1/domain-options' });

export interface CreateInput {
  provider: AliasProviderId;
  style: AliasStyle;
  /** Registrable domain of the page, e.g. "example.com". */
  site: string;
  domain: string | null;
  mailbox: string | null;
}

/** Runs the one or two requests that create an alias and returns it. */
export async function createAlias(input: CreateInput, send: Transport): Promise<AliasRef> {
  const hostname = encodeURIComponent(input.site);
  if (input.provider === 'simplelogin') {
    if (input.style !== 'site') {
      const mode = input.style === 'words' ? 'word' : 'uuid';
      return parseAlias('simplelogin', await send({ method: 'POST', path: `/api/alias/random/new?hostname=${hostname}&mode=${mode}`, body: { note: NOTE } }));
    }
    const suffix = parseSuffix(await send({ method: 'GET', path: `/api/v5/alias/options?hostname=${hostname}` }), input.site);
    const mailboxIds = input.mailbox && /^\d{1,18}$/.test(input.mailbox) ? [Number(input.mailbox)] : await defaultMailbox(send);
    return parseAlias(
      'simplelogin',
      await send({
        method: 'POST',
        path: `/api/v3/alias/custom/new?hostname=${hostname}`,
        body: { alias_prefix: suffix.prefix, signed_suffix: suffix.signedSuffix, mailbox_ids: mailboxIds, note: NOTE },
      }),
    );
  }
  const body: Record<string, unknown> = {
    domain: input.domain ?? (await addyDefaultDomain(send)),
    description: `${NOTE} for ${input.site}`,
    format: input.style === 'words' ? 'random_words' : input.style === 'chars' ? 'random_characters' : 'custom',
  };
  if (input.style === 'site') body.local_part = siteLabel(input.site);
  if (input.mailbox) body.recipient_ids = [input.mailbox];
  return parseAlias('addy', await send({ method: 'POST', path: '/api/v1/aliases', body }));
}

async function defaultMailbox(send: Transport): Promise<number[]> {
  const body = ok(await send({ method: 'GET', path: '/api/v2/mailboxes' }));
  const list = Array.isArray(body.mailboxes) ? body.mailboxes.map(record) : [];
  const pick = list.find((entry) => entry.default === true) ?? list[0];
  const id = typeof pick?.id === 'number' ? pick.id : Number(text(pick?.id));
  if (!Number.isFinite(id) || id <= 0) throw new AliasApiError('No SimpleLogin mailbox found.');
  return [id];
}

async function addyDefaultDomain(send: Transport): Promise<string> {
  const body = ok(await send(domainsRequest()));
  const fallback = text(body.defaultAliasDomain, 253) || (Array.isArray(body.data) ? text(body.data[0], 253) : '');
  if (!fallback) throw new AliasApiError('addy.io offered no alias domain.');
  return fallback;
}
