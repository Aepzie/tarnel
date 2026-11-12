import { app, ipcMain, net, safeStorage, webFrameMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents, type WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALIAS_IPC,
  type AliasAccount,
  type AliasOffer,
  type AliasOptions,
  type AliasProviderId,
  type AliasRef,
  type AliasSettingsPatch,
  type AliasSettingsView,
  type AliasStyle,
} from '../../shared/aliases';
import type { SpaceId } from '../../shared/types';
import { registrableDomain } from '../net/domain';
import { normaliseOrigin } from '../passwords/origin';
import { getTabSpaceId, getTabWebContents, onTabWebContents, tabIdForWebContents } from '../tabs';
import { sendToChrome } from '../window';
import { accountRequest, AliasApiError, apiBase, authHeaders, createAlias, domainsRequest, mailboxesRequest, parseAccount, parseDomains, parseMailboxes, validKey, type ApiRequest, type ApiResponse, type Transport } from './providers';

/**
 * Email aliases (docs/ARCHITECTURE.md → Email aliases). Main only:
 *  - provider settings + the API key in userData/aliases.json; the key is sealed with safeStorage
 *    and never sent to any renderer (tarnel://settings only learns whether one is set);
 *  - the passwords preload reports focus on an email field of a sign-up form; main offers an alias
 *    in the chrome UI and, after the click, creates it at the provider (net.fetch, 10 s timeout,
 *    no redirects) and sends the address to that frame only (same-origin top frame, like filling);
 *  - created aliases are remembered briefly so a password saved for the same site keeps the alias.
 */

const TIMEOUT_MS = 10_000;
const MAX_BODY = 256 * 1024;
const OFFER_TTL_MS = 5 * 60_000;
const CLAIM_TTL_MS = 30 * 60_000;
const STYLES: readonly AliasStyle[] = ['words', 'chars', 'site'];
const PROVIDERS: readonly AliasProviderId[] = ['simplelogin', 'addy'];

interface StoredSettings {
  provider: AliasProviderId | null;
  style: AliasStyle;
  domain: string | null;
  mailbox: string | null;
  /** base64 safeStorage ciphertext. */
  key: string | null;
  account: AliasAccount | null;
}

interface PendingOffer {
  offer: AliasOffer;
  spaceId: SpaceId;
  origin: string;
  frame: { processId: number; routingId: number };
  timer: NodeJS.Timeout;
  busy: boolean;
}

interface CreatedAlias {
  spaceId: SpaceId;
  origin: string;
  alias: AliasRef;
  at: number;
}

let cached: StoredSettings | null = null;
const offers = new Map<string, PendingOffer>();
const dismissed = new Set<string>();
let created: CreatedAlias[] = [];

const defaults = (): StoredSettings => ({ provider: null, style: 'words', domain: null, mailbox: null, key: null, account: null });

function encryptionAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
  } catch {
    return false;
  }
}

const settingsFile = (): string => path.join(app.getPath('userData'), 'aliases.json');
const optionalId = (value: unknown): string | null => (typeof value === 'string' && /^[A-Za-z0-9._@-]{1,253}$/.test(value) ? value : null);

function load(): StoredSettings {
  if (cached) return cached;
  let next = defaults();
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
    const account = raw.account && typeof raw.account === 'object' ? (raw.account as Record<string, unknown>) : null;
    next = {
      provider: PROVIDERS.includes(raw.provider as AliasProviderId) ? (raw.provider as AliasProviderId) : null,
      style: STYLES.includes(raw.style as AliasStyle) ? (raw.style as AliasStyle) : 'words',
      domain: optionalId(raw.domain),
      mailbox: optionalId(raw.mailbox),
      key: typeof raw.key === 'string' && raw.key.length < 4096 ? raw.key : null,
      account: account && typeof account.name === 'string' && typeof account.plan === 'string' ? { name: account.name.slice(0, 320), plan: account.plan.slice(0, 40) } : null,
    };
  } catch {
    /* defaults */
  }
  cached = next;
  return next;
}

function save(next: StoredSettings): void {
  cached = next;
  const file = settingsFile();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function apiKey(settings: StoredSettings): string | null {
  if (!settings.key || !encryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(settings.key, 'base64'));
  } catch {
    return null;
  }
}

function view(settings = load()): AliasSettingsView {
  return {
    provider: settings.provider,
    hasKey: settings.key !== null,
    style: settings.style,
    domain: settings.domain,
    mailbox: settings.mailbox,
    account: settings.account,
    encryption: encryptionAvailable(),
  };
}

/** True when the preload should watch email fields at all (zero cost otherwise). */
export function aliasesEnabled(): boolean {
  const settings = load();
  return settings.provider !== null && settings.key !== null;
}

// ---------------------------------------------------------------------------
// transport

function transport(provider: AliasProviderId, key: string): Transport {
  const base = apiBase(provider, process.env.VELA_ALIAS_API_BASE);
  return async (request: ApiRequest): Promise<ApiResponse> => {
    let response: Response;
    try {
      response = await net.fetch(`${base}${request.path}`, {
        method: request.method,
        headers: authHeaders(provider, key),
        body: request.body ? JSON.stringify(request.body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new AliasApiError('The alias provider could not be reached.');
    }
    const body = await response.text().catch(() => '');
    if (body.length > MAX_BODY) throw new AliasApiError('The provider sent an unexpectedly large answer.');
    let json: unknown = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  };
}

function readyTransport(): { settings: StoredSettings; provider: AliasProviderId; send: Transport } {
  const settings = load();
  const key = apiKey(settings);
  if (!settings.provider || !key) throw new Error('Email aliases are not set up.');
  return { settings, provider: settings.provider, send: transport(settings.provider, key) };
}

// ---------------------------------------------------------------------------
// tarnel://settings

function patchSettings(raw: unknown): AliasSettingsView {
  if (!raw || typeof raw !== 'object') throw new TypeError('Invalid patch');
  const patch = raw as AliasSettingsPatch;
  const current = load();
  let next = { ...current };
  if (patch.provider !== undefined) {
    if (patch.provider !== null && !PROVIDERS.includes(patch.provider)) throw new TypeError('Invalid provider');
    if (patch.provider !== current.provider) next = { ...defaults(), provider: patch.provider, style: current.style };
  }
  if (patch.style !== undefined) {
    if (!STYLES.includes(patch.style)) throw new TypeError('Invalid style');
    next.style = patch.style;
  }
  if (patch.domain !== undefined) next.domain = patch.domain === null ? null : (optionalId(patch.domain) ?? current.domain);
  if (patch.mailbox !== undefined) next.mailbox = patch.mailbox === null ? null : (optionalId(patch.mailbox) ?? current.mailbox);
  save(next);
  if (!aliasesEnabled()) for (const id of [...offers.keys()]) cancelOffer(id);
  return view(next);
}

/** Validates the key with one cheap authenticated call, then seals it. null removes the key. */
async function setKey(raw: unknown): Promise<AliasSettingsView> {
  const current = load();
  if (raw === null) {
    save({ ...current, key: null, account: null, domain: null, mailbox: null });
    for (const id of [...offers.keys()]) cancelOffer(id);
    return view();
  }
  if (!current.provider) throw new Error('Choose a provider first.');
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!validKey(key)) throw new TypeError('That does not look like an API key.');
  if (!encryptionAvailable()) throw new Error('OS encryption (safeStorage) is not available, so the key cannot be stored.');
  const account = parseAccount(current.provider, await transport(current.provider, key)(accountRequest(current.provider)));
  save({ ...load(), key: safeStorage.encryptString(key).toString('base64'), account, domain: null, mailbox: null });
  return view();
}

async function options(): Promise<AliasOptions> {
  const { provider, send } = readyTransport();
  const mailboxes = parseMailboxes(provider, await send(mailboxesRequest(provider)));
  const domains = provider === 'addy' ? parseDomains(await send(domainsRequest())) : [];
  return { mailboxes, domains };
}

// ---------------------------------------------------------------------------
// frames + chrome

function frameContext(event: IpcMainEvent): { tabId: number; spaceId: SpaceId; origin: string; frame: WebFrameMain } | null {
  const frame = event.senderFrame;
  if (!frame) return null;
  const tabId = tabIdForWebContents(event.sender.id);
  if (tabId === null) return null;
  const spaceId = getTabSpaceId(tabId);
  const origin = normaliseOrigin(frame.url);
  if (!spaceId || !origin || normaliseOrigin(frame.top?.url ?? '') !== origin) return null;
  return { tabId, spaceId, origin, frame };
}

function cancelOffer(id: string): void {
  const pending = offers.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  offers.delete(id);
  sendToChrome(ALIAS_IPC.offerCancel, id);
}

function cancelOffersForTab(tabId: number): void {
  for (const [id, pending] of offers) if (pending.offer.tabId === tabId) cancelOffer(id);
  for (const key of [...dismissed]) if (key.startsWith(`${tabId}|`)) dismissed.delete(key);
}

function onFieldSeen(event: IpcMainEvent): void {
  if (!aliasesEnabled()) return;
  const context = frameContext(event);
  if (!context || dismissed.has(`${context.tabId}|${context.origin}`)) return;
  for (const pending of offers.values()) if (pending.offer.tabId === context.tabId && pending.origin === context.origin) return;
  cancelOffersForTab(context.tabId);
  const host = new URL(context.origin).hostname;
  const id = randomUUID();
  const offer: AliasOffer = { id, tabId: context.tabId, site: registrableDomain(host) || host, provider: load().provider as AliasProviderId };
  const timer = setTimeout(() => cancelOffer(id), OFFER_TTL_MS);
  timer.unref?.();
  offers.set(id, { offer, spaceId: context.spaceId, origin: context.origin, frame: { processId: context.frame.processId, routingId: context.frame.routingId }, timer, busy: false });
  sendToChrome(ALIAS_IPC.offer, offer);
}

function liveFrame(pending: PendingOffer): WebFrameMain | null {
  let frame: WebFrameMain | null | undefined;
  try {
    frame = webFrameMain.fromId(pending.frame.processId, pending.frame.routingId);
  } catch {
    frame = null;
  }
  if (!frame || frame.detached) return null;
  const wc = getTabWebContents(pending.offer.tabId);
  if (!wc || wc.isDestroyed() || getTabSpaceId(pending.offer.tabId) !== pending.spaceId) return null;
  if (normaliseOrigin(frame.url) !== pending.origin || normaliseOrigin(frame.top?.url ?? '') !== pending.origin) return null;
  return frame;
}

/** The user clicked "Create alias": create it at the provider, then fill that frame's field. */
async function create(offerId: unknown): Promise<{ email: string }> {
  if (typeof offerId !== 'string') throw new TypeError('Invalid id');
  const pending = offers.get(offerId);
  if (!pending) throw new Error('This offer has expired.');
  if (pending.busy) throw new Error('Already creating an alias.');
  if (!liveFrame(pending)) {
    cancelOffer(offerId);
    throw new Error('The page changed.');
  }
  pending.busy = true;
  try {
    const { settings, provider, send } = readyTransport();
    const alias = await createAlias({ provider, style: settings.style, site: pending.offer.site, domain: settings.domain, mailbox: settings.mailbox }, send);
    const now = Date.now();
    created = [...created.filter((entry) => now - entry.at < CLAIM_TTL_MS), { spaceId: pending.spaceId, origin: pending.origin, alias, at: now }].slice(-50);
    const frame = liveFrame(pending);
    if (frame) frame.send(ALIAS_IPC.frameFill, alias.email);
    cancelOffer(offerId);
    return { email: alias.email };
  } catch (error) {
    pending.busy = false;
    if (error instanceof AliasApiError) throw new Error(error.message);
    throw error;
  }
}

/** Called when a login is saved: the alias created for this site + username, if any. */
export function claimAlias(spaceId: SpaceId, origin: string, username: string): AliasRef | null {
  const now = Date.now();
  const match = created.find((entry) => entry.spaceId === spaceId && entry.origin === origin && entry.alias.email.toLowerCase() === username.trim().toLowerCase() && now - entry.at < CLAIM_TTL_MS);
  if (!match) return null;
  created = created.filter((entry) => entry !== match);
  return match.alias;
}

function fromSettingsPage(event: IpcMainInvokeEvent): boolean {
  try {
    return new URL(event.senderFrame?.url ?? '').host === 'settings';
  } catch {
    return false;
  }
}

type ChromeHandler = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type PagesHandler = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;

function watchTab(wc: WebContents, tabId: number): void {
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) cancelOffersForTab(tabId);
  });
  wc.once('destroyed', () => cancelOffersForTab(tabId));
}

export function registerAliasIpc(handleChrome: ChromeHandler, handlePages: PagesHandler): void {
  const own = (channel: string, fn: (...args: unknown[]) => unknown): void =>
    handlePages(channel, (event, ...args) => {
      if (!fromSettingsPage(event)) throw new Error('Forbidden');
      return fn(...args);
    });
  own(ALIAS_IPC.get, () => view());
  own(ALIAS_IPC.set, (patch) => patchSettings(patch));
  own(ALIAS_IPC.setKey, (key) => setKey(key));
  own(ALIAS_IPC.options, () => options());
  handleChrome(ALIAS_IPC.create, (offerId) => create(offerId));
  handleChrome(ALIAS_IPC.dismiss, (offerId) => {
    if (typeof offerId !== 'string') return;
    const pending = offers.get(offerId);
    if (pending) dismissed.add(`${pending.offer.tabId}|${pending.origin}`);
    cancelOffer(offerId);
  });
  ipcMain.on(ALIAS_IPC.frameFieldSeen, (event) => {
    try {
      onFieldSeen(event);
    } catch {
      /* never break the page */
    }
  });
  onTabWebContents(watchTab);
}
