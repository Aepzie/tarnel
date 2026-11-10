import { useSyncExternalStore } from 'react';
import { FASTEST_ID, LICENSE_PATTERN, mockIp, resolveServer } from './vpn-data';

/**
 * VPN preview state, entirely renderer-side. This is a UI mock: connecting only flips local state
 * after a timer; no proxy, route or network setting is touched anywhere. Real provider integration
 * (via main) comes later. License + server choice + favorites persist in localStorage.
 */
export type VpnView = 'providers' | 'mantel' | 'servers';
export type VpnStatus = 'off' | 'connecting' | 'connected';

export interface VpnLicense {
  key: string;
  activatedAt: number;
}

interface Persisted {
  license: VpnLicense | null;
  serverId: string;
  favorites: readonly string[];
}

export interface VpnSnapshot extends Persisted {
  open: boolean;
  view: VpnView;
  status: VpnStatus;
  checking: boolean;
  /** Server actually in use while connecting/connected (Fastest resolved). */
  activeServerId: string | null;
  connectedAt: number | null;
  ip: string | null;
}

const STORAGE_KEY = 'vela:vpn-preview';
export const CHECK_MS = 800;
export const CONNECT_MS = 1500;

function load(): Persisted {
  const fallback: Persisted = { license: null, serverId: FASTEST_ID, favorites: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const license =
      parsed.license && typeof parsed.license.key === 'string' && LICENSE_PATTERN.test(parsed.license.key) && typeof parsed.license.activatedAt === 'number'
        ? parsed.license
        : null;
    return {
      license,
      serverId: typeof parsed.serverId === 'string' ? parsed.serverId : FASTEST_ID,
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    return fallback;
  }
}

function save(): void {
  const { license, serverId, favorites } = snapshot;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ license, serverId, favorites }));
  } catch {
    /* storage unavailable: keep in-memory state only */
  }
}

let snapshot: VpnSnapshot = {
  ...load(),
  open: false,
  view: 'providers',
  status: 'off',
  checking: false,
  activeServerId: null,
  connectedAt: null,
  ip: null,
};
const listeners = new Set<() => void>();
let connectTimer: number | null = null;

function emit(next: Partial<VpnSnapshot>, persist = false): void {
  snapshot = { ...snapshot, ...next };
  if (persist) save();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVpn(): VpnSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

function clearConnectTimer(): void {
  if (connectTimer === null) return;
  window.clearTimeout(connectTimer);
  connectTimer = null;
}

export const vpn = {
  setOpen(open: boolean): void {
    if (open === snapshot.open) return;
    emit(open ? { open, view: snapshot.license ? 'mantel' : 'providers' } : { open });
  },
  open(): void {
    vpn.setOpen(true);
  },
  close(): void {
    vpn.setOpen(false);
  },
  toggle(): void {
    vpn.setOpen(!snapshot.open);
  },
  setView(view: VpnView): void {
    emit({ view });
  },
  /** Mock activation: any well-formed key passes after a fake check. Resolves to an error or null. */
  async activate(key: string): Promise<string | null> {
    if (!LICENSE_PATTERN.test(key)) return 'Not a valid key. Use the format MNTL-XXXX-XXXX-XXXX.';
    emit({ checking: true });
    await new Promise((resolve) => window.setTimeout(resolve, CHECK_MS));
    emit({ checking: false, license: { key, activatedAt: Date.now() } }, true);
    return null;
  },
  removeLicense(): void {
    vpn.disconnect();
    emit({ license: null, view: 'providers' }, true);
  },
  selectServer(serverId: string): void {
    emit({ serverId, view: 'mantel' }, true);
    if (snapshot.status !== 'off') vpn.connect();
  },
  toggleFavorite(serverId: string): void {
    const favorites = snapshot.favorites.includes(serverId)
      ? snapshot.favorites.filter((id) => id !== serverId)
      : [...snapshot.favorites, serverId];
    emit({ favorites }, true);
  },
  connect(): void {
    if (!snapshot.license) return;
    clearConnectTimer();
    const server = resolveServer(snapshot.serverId);
    emit({ status: 'connecting', activeServerId: server.id, connectedAt: null, ip: null });
    connectTimer = window.setTimeout(() => {
      connectTimer = null;
      emit({ status: 'connected', connectedAt: Date.now(), ip: mockIp(server.id) });
    }, CONNECT_MS);
  },
  disconnect(): void {
    clearConnectTimer();
    emit({ status: 'off', activeServerId: null, connectedAt: null, ip: null });
  },
};
