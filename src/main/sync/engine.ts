import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  DEFAULT_SYNC_CATEGORIES,
  SPACE_COLORS,
  type SpaceColor,
  type Suggestion,
  type SyncCategories,
  type SyncSetupInput,
  type SyncStatus,
  type SyncTransportInput,
} from '../../shared/types';
import {
  SyncCryptoError,
  createKeyFile,
  formatRecoveryKey,
  open,
  parseKeyFile,
  parseRecoveryKey,
  seal,
  unwrapWithPassphrase,
  verifyDataKey,
} from './crypto';
import { SYNC_CONFIG_FILE, type SyncHost } from './host';
import { HybridClock, isRecord, mergeRecords, sameValue, type SyncRecord } from './records';
import { canSyncSetting, remoteSettingsPatch } from './settings-policy';
import { DEVICE_FILE, KEY_FILE, folderTransport, normalizeWebdavUrl, webdavTransport, type Transport } from './transport';

/**
 * The sync engine. Built as its own bundle (dist/main/sync.js) and only `require`d once the user
 * turns sync on — with sync off it is never parsed, and nothing below costs anything.
 */

const DB_FILE = 'sync-db.json';
const PERIOD_MS = 5 * 60_000;
const STARTUP_DELAY_MS = 3_000;
const QUICK_DELAY_MS = 2_000;
const TABS_DELAY_MS = 30_000;
const HISTORY_LIMIT = 2_000;
const TABS_LIMIT = 200;
const REMOTE_TAB_MAX_AGE_MS = 30 * 86_400_000;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MIN_PASSPHRASE = 8;
type StoredTransport =
  | { kind: 'folder'; path: string }
  | { kind: 'webdav'; url: string; username: string; /** safeStorage-protected */ password: string };

interface SyncConfig {
  v: 1;
  enabled: boolean;
  deviceId: string;
  transport: StoredTransport | null;
  /** The data key, safeStorage-protected (base64). Never written anywhere else on this device. */
  dataKey: string;
  categories: SyncCategories;
  /** Joined an existing sync: pull before publishing anything, and pair same-named spaces. */
  joinPending: boolean;
  /** Remote space id → local space id, for local spaces paired with a remote twin on join. */
  idMap: Record<string, string>;
}

interface SyncDb {
  clock: number;
  records: SyncRecord[];
  /** Remote file name → version last merged. */
  seen: Record<string, string>;
  devices: Record<string, { name: string; lastSeen: number }>;
  lastSyncAt: number | null;
  ownDirty: boolean;
}

interface ChangesPayload {
  device: { id: string; name: string };
  at: number;
  records: SyncRecord[];
}

interface SpaceFields {
  name: string;
  color: SpaceColor;
  proxy: string;
}

interface HistoryFields {
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
}

export interface SyncEngine {
  status(): SyncStatus;
  probe(transport: SyncTransportInput): Promise<{ exists: boolean }>;
  enable(input: SyncSetupInput): Promise<SyncStatus>;
  setCategories(categories: SyncCategories): Promise<SyncStatus>;
  syncNow(): Promise<SyncStatus>;
  recoveryKey(): string;
  disconnect(wipeRemote: boolean): Promise<SyncStatus>;
  remoteTabs(query: string, limit: number): Suggestion[];
  start(): void;
  stop(): void;
}

function defaultConfig(): SyncConfig {
  return { v: 1, enabled: false, deviceId: '', transport: null, dataKey: '', categories: { ...DEFAULT_SYNC_CATEGORIES }, joinPending: false, idMap: {} };
}

function emptyDb(): SyncDb {
  return { clock: 0, records: [], seen: {}, devices: {}, lastSyncAt: null, ownDirty: true };
}

function readJson<T extends object>(file: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...fallback, ...(parsed as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function message(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Sync failed';
}

function historyKey(url: string): string {
  return `h/${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
}

function spaceFields(value: unknown): SpaceFields | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<SpaceFields>;
  if (typeof v.name !== 'string' || !v.name.trim() || !SPACE_COLORS.includes(v.color as SpaceColor)) return null;
  return { name: v.name.slice(0, 32), color: v.color as SpaceColor, proxy: typeof v.proxy === 'string' ? v.proxy.slice(0, 200) : '' };
}

function historyFields(value: unknown): HistoryFields | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<HistoryFields>;
  if (typeof v.url !== 'string' || !/^https?:\/\//i.test(v.url) || v.url.length > 8192) return null;
  if (typeof v.visits !== 'number' || typeof v.lastVisit !== 'number') return null;
  return { url: v.url, title: typeof v.title === 'string' ? v.title.slice(0, 300) : '', visits: v.visits, lastVisit: v.lastVisit };
}

function transportFor(stored: StoredTransport, unprotect: (sealed: string) => string): Transport {
  if (stored.kind === 'folder') return folderTransport(stored.path);
  return webdavTransport(stored.url, stored.username, unprotect(stored.password));
}

function transportFromInput(input: SyncTransportInput): Transport {
  if (input.kind === 'folder') {
    if (!input.path || !path.isAbsolute(input.path)) throw new Error('Choose a folder');
    return folderTransport(input.path);
  }
  if (!input.username) throw new Error('Enter your WebDAV username');
  if (!input.password) throw new Error('Enter an app password');
  return webdavTransport(input.url, input.username, input.password);
}

function transportLabel(stored: StoredTransport): string {
  if (stored.kind === 'folder') return stored.path;
  try {
    const url = new URL(stored.url);
    return `${stored.username}@${url.host}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return stored.url;
  }
}

export function createSyncEngine(host: SyncHost): SyncEngine {
  const configFile = path.join(host.userDataDir, SYNC_CONFIG_FILE);
  const dbFile = path.join(host.userDataDir, DB_FILE);

  let config = readJson<SyncConfig>(configFile, defaultConfig());
  let db = readJson<SyncDb>(dbFile, emptyDb());
  const records = new Map<string, SyncRecord>((Array.isArray(db.records) ? db.records : []).filter(isRecord).map((r) => [r.k, r]));
  const clock = new HybridClock(typeof db.clock === 'number' ? db.clock : 0);

  let dataKey: Buffer | null = null;
  let transport: Transport | null = null;
  let periodic: NodeJS.Timeout | null = null;
  let pending: NodeJS.Timeout | null = null;
  let pendingAt = Infinity;
  let running: Promise<void> | null = null;
  let again = false;
  let lastError: string | null = null;
  let started = false;
  let unwatch: (() => void) | null = null;

  const ownFile = (): string => `dev-${config.deviceId}.vsync`;

  const saveConfig = (): void => writeJsonAtomic(configFile, config);
  const saveDb = (): void => {
    db = { ...db, clock: clock.value, records: [...records.values()] };
    writeJsonAtomic(dbFile, db);
  };

  const key = (): Buffer => {
    if (dataKey) return dataKey;
    try {
      dataKey = Buffer.from(host.unprotect(config.dataKey), 'base64');
    } catch {
      throw new Error('This device can no longer read its sync key. Disconnect and join again.');
    }
    return dataKey;
  };

  const remote = (): Transport => {
    if (transport) return transport;
    if (!config.transport) throw new Error('Sync is not set up');
    try {
      transport = transportFor(config.transport, (sealed) => host.unprotect(sealed));
    } catch (err) {
      throw new Error(`Sync storage unavailable: ${message(err)}`);
    }
    return transport;
  };

  // -------------------------------------------------------------------------
  // local ⇄ records

  const put = (k: string, v: unknown): void => {
    records.set(k, { k, v, c: clock.tick(), d: config.deviceId });
    db.ownDirty = true;
  };

  const syncIdFor = (localId: string): string => Object.entries(config.idMap).find(([, local]) => local === localId)?.[0] ?? localId;

  /** Turns local state into records; returns nothing, marks the own file dirty on any change. */
  const capture = (): void => {
    const cats = config.categories;
    const local = new Map<string, unknown>();
    const tombstoned: string[] = [];
    if (cats.settings) {
      for (const [name, value] of Object.entries(host.getSettings())) {
        if (canSyncSetting(name)) local.set(`s/${name}`, value);
      }
    }
    if (cats.spaces) {
      tombstoned.push('sp/');
      for (const space of host.listSpaces()) {
        if (space.ephemeral) continue;
        local.set(`sp/${syncIdFor(space.id)}`, { name: space.name, color: space.color, proxy: space.proxy } satisfies SpaceFields);
      }
    }
    if (cats.tabs) {
      const tabs = host
        .listTabs()
        .filter((tab) => /^https?:\/\//i.test(tab.url))
        .slice(0, TABS_LIMIT)
        .map((tab) => ({ url: tab.url, title: tab.title.slice(0, 200), pinned: tab.pinned }));
      local.set(`t/${config.deviceId}`, { name: host.deviceName, tabs });
    }
    if (cats.history) {
      for (const entry of host.listHistory(HISTORY_LIMIT)) {
        local.set(historyKey(entry.url), { url: entry.url, title: entry.title, visits: entry.visits, lastVisit: entry.lastVisit } satisfies HistoryFields);
      }
    }
    for (const [k, v] of local) {
      const current = records.get(k);
      if (current && current.v !== null && sameValue(current.v, v)) continue;
      put(k, v);
    }
    for (const [k, current] of records) {
      if (current.v !== null && !local.has(k) && tombstoned.some((prefix) => k.startsWith(prefix))) put(k, null);
    }
  };

  const applySpace = async (record: SyncRecord): Promise<void> => {
    const syncId = record.k.slice(3);
    const localId = config.idMap[syncId] ?? syncId;
    const spaces = host.listSpaces();
    const existing = spaces.find((space) => space.id === localId && !space.ephemeral);
    if (record.v === null) {
      if (existing) await host.removeSpace(localId).catch(() => undefined);
      return;
    }
    const fields = spaceFields(record.v);
    if (!fields) return;
    if (existing) {
      if (existing.name !== fields.name || existing.color !== fields.color || existing.proxy !== fields.proxy) host.upsertSpace(localId, fields);
      return;
    }
    if (config.joinPending) {
      const paired = new Set(Object.values(config.idMap));
      const twin = spaces.find(
        (space) => !space.ephemeral && !paired.has(space.id) && !records.has(`sp/${space.id}`) && space.name.toLowerCase() === fields.name.toLowerCase(),
      );
      if (twin) {
        config.idMap[syncId] = twin.id;
        host.upsertSpace(twin.id, fields);
        return;
      }
    }
    if (!/^[\w-]{1,64}$/.test(syncId)) return;
    host.upsertSpace(syncId, fields);
  };

  /** Applies records written by other devices to the browser. */
  const apply = async (adopted: readonly SyncRecord[]): Promise<void> => {
    const cats = config.categories;
    const patch = cats.settings ? remoteSettingsPatch(adopted, config.deviceId) : {};
    const history: HistoryFields[] = [];
    for (const record of adopted) {
      if (record.d === config.deviceId) continue;
      if (record.k.startsWith('sp/')) {
        if (cats.spaces) await applySpace(record);
      } else if (record.k.startsWith('h/')) {
        const fields = cats.history ? historyFields(record.v) : null;
        if (fields) history.push(fields);
      }
    }
    if (Object.keys(patch).length > 0) host.applySettings(patch);
    if (history.length > 0) host.mergeHistory(history);
  };

  // -------------------------------------------------------------------------
  // one sync cycle: verify key → capture → pull + merge → apply → push

  const pull = async (remoteTransport: Transport, files: { name: string; version: string }[]): Promise<{ adopted: SyncRecord[]; errors: string[] }> => {
    const adopted: SyncRecord[] = [];
    const errors: string[] = [];
    const present = new Set<string>();
    for (const file of files) {
      const match = DEVICE_FILE.exec(file.name);
      if (!match || match[1] === config.deviceId) continue;
      const deviceId = match[1]!;
      present.add(deviceId);
      if (db.seen[file.name] === file.version) continue;
      try {
        const raw = await remoteTransport.read(file.name);
        if (!raw) continue;
        const { header, plaintext } = open(key(), raw, 'changes');
        if (header.device !== deviceId) throw new SyncCryptoError('A sync file does not belong to its device');
        const payload = JSON.parse(gunzipSync(plaintext, { maxOutputLength: MAX_PAYLOAD_BYTES }).toString('utf8')) as Partial<ChangesPayload>;
        const incoming = (Array.isArray(payload.records) ? payload.records : []).filter((r): r is SyncRecord => isRecord(r) && r.d === deviceId);
        for (const record of incoming) clock.observe(record.c);
        adopted.push(...mergeRecords(records, incoming));
        db.devices[deviceId] = {
          name: typeof payload.device?.name === 'string' ? payload.device.name.slice(0, 64) : 'Unknown device',
          lastSeen: typeof payload.at === 'number' ? payload.at : 0,
        };
        db.seen[file.name] = file.version;
      } catch (err) {
        errors.push(err instanceof SyncCryptoError ? `Couldn’t read another device’s data: ${err.message}` : message(err));
      }
    }
    for (const id of Object.keys(db.devices)) if (!present.has(id)) delete db.devices[id];
    return { adopted, errors };
  };

  const push = async (remoteTransport: Transport): Promise<void> => {
    const payload: ChangesPayload = {
      device: { id: config.deviceId, name: host.deviceName },
      at: Date.now(),
      records: [...records.values()].filter((r) => r.d === config.deviceId),
    };
    const blob = seal(key(), { v: 1, kind: 'changes', device: config.deviceId }, gzipSync(Buffer.from(JSON.stringify(payload), 'utf8')));
    await remoteTransport.write(ownFile(), blob);
    db.ownDirty = false;
  };

  const cycle = async (): Promise<void> => {
    const remoteTransport = remote();
    const files = await remoteTransport.list();
    const keyEntry = files.find((file) => file.name === KEY_FILE);
    if (!keyEntry) throw new Error('The sync data was removed from the remote. Disconnect and set up sync again.');
    if (db.seen[KEY_FILE] !== keyEntry.version) {
      const raw = await remoteTransport.read(KEY_FILE);
      if (!raw || !verifyDataKey(parseKeyFile(raw), key())) {
        throw new Error('Sync was reset with a new passphrase on another device. Disconnect and join again.');
      }
      db.seen[KEY_FILE] = keyEntry.version;
    }

    if (!config.joinPending) capture();
    const { adopted, errors } = await pull(remoteTransport, files);
    await apply(adopted);
    if (config.joinPending) {
      capture();
      config.joinPending = false;
      saveConfig();
    }
    if (db.ownDirty || !files.some((file) => file.name === ownFile())) await push(remoteTransport);
    db.lastSyncAt = Date.now();
    saveDb();
    if (errors.length > 0) throw new Error(errors[0]);
  };

  const syncNow = async (): Promise<SyncStatus> => {
    if (!config.enabled) return status();
    if (running) {
      again = true;
      await running;
      return status();
    }
    running = (async () => {
      try {
        do {
          again = false;
          await cycle();
          lastError = null;
        } while (again && config.enabled);
      } catch (err) {
        lastError = message(err);
      } finally {
        running = null;
      }
    })();
    await running;
    return status();
  };

  /** Runs a sync at the latest after `delay` (never postpones an earlier pending one). */
  const schedule = (delay: number): void => {
    if (!config.enabled) return;
    const at = Date.now() + delay;
    if (pending && pendingAt <= at) return;
    if (pending) clearTimeout(pending);
    pendingAt = at;
    pending = setTimeout(() => {
      pending = null;
      pendingAt = Infinity;
      void syncNow();
    }, delay);
    pending.unref?.();
  };

  host.onLocalChange((source) => {
    if (!config.enabled) return;
    const cats = config.categories;
    if (source === 'settings' && cats.settings) schedule(QUICK_DELAY_MS);
    else if (source === 'spaces' && cats.spaces) schedule(QUICK_DELAY_MS);
    else if (source === 'tabs' && (cats.tabs || cats.history)) schedule(TABS_DELAY_MS);
  });

  // -------------------------------------------------------------------------
  // public API

  function status(): SyncStatus {
    const others = Object.entries(db.devices)
      .map(([id, device]) => ({ id, name: device.name, lastSeen: device.lastSeen, current: false }))
      .sort((a, b) => b.lastSeen - a.lastSeen);
    return {
      enabled: config.enabled,
      secureStorage: host.secureStorageAvailable(),
      transport: config.enabled && config.transport ? { kind: config.transport.kind, label: transportLabel(config.transport) } : null,
      categories: { ...config.categories },
      syncing: running !== null,
      lastSyncAt: config.enabled ? db.lastSyncAt : null,
      lastError: config.enabled ? lastError : null,
      devices: config.enabled ? [{ id: config.deviceId, name: host.deviceName, lastSeen: db.lastSyncAt ?? 0, current: true }, ...others] : [],
    };
  }

  function start(): void {
    if (started || !config.enabled) return;
    started = true;
    periodic = setInterval(() => void syncNow(), PERIOD_MS);
    periodic.unref?.();
    schedule(STARTUP_DELAY_MS);
    try {
      unwatch = remote().watch?.((name) => {
        if (name !== ownFile()) schedule(QUICK_DELAY_MS);
      }) ?? null;
    } catch {
      unwatch = null;
    }
  }

  function stop(): void {
    started = false;
    if (periodic) clearInterval(periodic);
    if (pending) clearTimeout(pending);
    unwatch?.();
    unwatch = null;
    periodic = null;
    pending = null;
    pendingAt = Infinity;
  }

  async function probe(input: SyncTransportInput): Promise<{ exists: boolean }> {
    const candidate = transportFromInput(input);
    return { exists: (await candidate.read(KEY_FILE)) !== null };
  }

  async function enable(input: SyncSetupInput): Promise<SyncStatus> {
    if (!host.secureStorageAvailable()) throw new Error('This system has no secure key storage, so Tarnel can’t keep your sync key safe.');
    if (config.enabled) throw new Error('Sync is already on');
    const candidate = transportFromInput(input.transport);
    await candidate.ensure();
    const existing = await candidate.read(KEY_FILE);
    let newKey: Buffer;
    if (input.mode === 'create') {
      if (existing) throw new Error('This location already has Tarnel sync data. Join it instead.');
      if (input.secret.normalize('NFKC').length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters`);
      const created = await createKeyFile(input.secret);
      await candidate.write(KEY_FILE, Buffer.from(JSON.stringify(created.keyFile, null, 2), 'utf8'));
      newKey = created.dataKey;
    } else {
      if (!existing) throw new Error('No Tarnel sync data found at this location');
      const keyFile = parseKeyFile(existing);
      const recovery = parseRecoveryKey(input.secret);
      if (recovery) {
        if (!verifyDataKey(keyFile, recovery)) throw new SyncCryptoError('Wrong recovery key');
        newKey = recovery;
      } else {
        newKey = await unwrapWithPassphrase(keyFile, input.secret);
      }
    }

    const stored: StoredTransport =
      input.transport.kind === 'folder'
        ? { kind: 'folder', path: input.transport.path }
        : { kind: 'webdav', url: normalizeWebdavUrl(input.transport.url), username: input.transport.username, password: host.protect(input.transport.password) };
    config = {
      v: 1,
      enabled: true,
      deviceId: randomBytes(8).toString('hex'),
      transport: stored,
      dataKey: host.protect(newKey.toString('base64')),
      categories: { ...input.categories },
      joinPending: input.mode === 'join',
      idMap: {},
    };
    dataKey = newKey;
    transport = candidate;
    records.clear();
    db = emptyDb();
    lastError = null;
    saveConfig();
    saveDb();
    start();
    return syncNow();
  }

  async function setCategories(categories: SyncCategories): Promise<SyncStatus> {
    const before = config.categories;
    config = { ...config, categories: { ...categories } };
    saveConfig();
    if (!config.enabled) return status();
    if (before.tabs && !categories.tabs && records.get(`t/${config.deviceId}`)?.v != null) put(`t/${config.deviceId}`, null);
    const turnedOn = (Object.keys(categories) as (keyof SyncCategories)[]).filter((name) => categories[name] && !before[name]);
    if (turnedOn.length > 0) {
      const prefixes = turnedOn.map((name) => ({ settings: 's/', spaces: 'sp/', tabs: 't/', history: 'h/' })[name]);
      await apply([...records.values()].filter((r) => prefixes.some((prefix) => r.k.startsWith(prefix))));
    }
    return syncNow();
  }

  function recoveryKey(): string {
    if (!config.enabled) throw new Error('Sync is off');
    return formatRecoveryKey(key());
  }

  async function disconnect(wipeRemote: boolean): Promise<SyncStatus> {
    if (!config.enabled) return status();
    stop();
    if (running) await running.catch(() => undefined);
    try {
      const remoteTransport = remote();
      if (wipeRemote) {
        const files = await remoteTransport.list();
        for (const file of files.filter((f) => f.name !== KEY_FILE)) await remoteTransport.remove(file.name);
        await remoteTransport.remove(KEY_FILE);
      } else {
        await remoteTransport.remove(ownFile());
      }
    } catch (err) {
      if (wipeRemote) {
        start();
        throw new Error(`Couldn’t delete the remote data: ${message(err)}`);
      }
    }
    config = { ...defaultConfig(), categories: config.categories };
    dataKey = null;
    transport = null;
    records.clear();
    db = emptyDb();
    lastError = null;
    saveConfig();
    fs.rmSync(dbFile, { force: true });
    return status();
  }

  function remoteTabs(query: string, limit: number): Suggestion[] {
    if (!config.enabled || !config.categories.tabs || limit <= 0) return [];
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const cutoff = Date.now() - REMOTE_TAB_MAX_AGE_MS;
    const results: Suggestion[] = [];
    for (const record of records.values()) {
      if (!record.k.startsWith('t/') || record.d === config.deviceId || record.v === null || record.c < cutoff) continue;
      const value = record.v as { name?: unknown; tabs?: unknown };
      if (!Array.isArray(value.tabs)) continue;
      const device = typeof value.name === 'string' ? value.name : 'Other device';
      for (const tab of value.tabs as { url?: unknown; title?: unknown }[]) {
        if (typeof tab.url !== 'string' || !/^https?:\/\//i.test(tab.url)) continue;
        const title = typeof tab.title === 'string' ? tab.title : '';
        const haystack = `${tab.url} ${title}`.toLowerCase();
        if (!tokens.every((token) => haystack.includes(token))) continue;
        results.push({ kind: 'remote-tab', title: title || tab.url, url: tab.url, device });
        if (results.length >= limit) return results;
      }
    }
    return results;
  }

  return { status, probe, enable, setCategories, syncNow, recoveryKey, disconnect, remoteTabs, start, stop };
}
