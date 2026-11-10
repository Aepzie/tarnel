import { useSyncExternalStore } from 'react';
import type { VpnMode, VpnServer, VpnState } from '@shared/vpn';
import { FASTEST_ID, SERVERS, mockIp, resolveServer } from './vpn-data';

/**
 * VPN panel state. Account, expiry, servers and the live connection come from main (window.vela.vpn,
 * src/main/vpn): signing in and connecting talk to the Mantel API there; the account number never
 * reaches the renderer after submit. When Mantel is unreachable main reports "preview" and the panel
 * falls back to simulated servers and a simulated connection. Server choice + favorites persist in
 * localStorage.
 */
export type VpnView = 'providers' | 'mantel' | 'servers';
export type VpnStatus = 'off' | 'connecting' | 'connected';

interface Persisted {
  serverId: string;
  favorites: readonly string[];
}

export interface VpnSnapshot extends Persisted {
  open: boolean;
  view: VpnView;
  mode: VpnMode;
  accountTail: string | null;
  paidUntil: string | null;
  /** Live Mantel servers, or preview data. */
  servers: readonly VpnServer[];
  notice: string | null;
  status: VpnStatus;
  checking: boolean;
  /** Server actually in use while connecting/connected (Fastest resolved). */
  activeServerId: string | null;
  connectedAt: number | null;
  /** Live: the Mantel proxy host the Space routes through; preview: a simulated address. */
  ip: string | null;
  error: string | null;
}

const STORAGE_KEY = 'vela:vpn';
export const CONNECT_MS = 1500;

function load(): Persisted {
  const fallback: Persisted = { serverId: FASTEST_ID, favorites: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      serverId: typeof parsed.serverId === 'string' ? parsed.serverId : FASTEST_ID,
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    return fallback;
  }
}

function save(): void {
  const { serverId, favorites } = snapshot;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ serverId, favorites }));
  } catch {
    /* storage unavailable: keep in-memory state only */
  }
}

let snapshot: VpnSnapshot = {
  ...load(),
  open: false,
  view: 'providers',
  mode: 'signed-out',
  accountTail: null,
  paidUntil: null,
  servers: SERVERS,
  notice: null,
  status: 'off',
  checking: false,
  activeServerId: null,
  connectedAt: null,
  ip: null,
  error: null,
};
const listeners = new Set<() => void>();
let previewTimer: number | null = null;

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

function clearPreviewTimer(): void {
  if (previewTimer === null) return;
  window.clearTimeout(previewTimer);
  previewTimer = null;
}

/** Merges main's state; a live connection in main wins over local status. */
function applyState(state: VpnState): void {
  const servers = state.mode === 'live' ? state.servers : SERVERS;
  const live = state.connection;
  const preview = state.mode === 'preview' && snapshot.status !== 'off';
  emit({
    mode: state.mode,
    accountTail: state.accountTail,
    paidUntil: state.paidUntil,
    servers,
    notice: state.notice,
    ...(live
      ? { status: 'connected' as const, activeServerId: live.serverId, connectedAt: live.connectedAt, ip: live.proxy.replace(/:\d+$/, '').replace(/^\[|\]$/g, '') }
      : preview
        ? {}
        : snapshot.status === 'connecting'
          ? {}
          : { status: 'off' as const, activeServerId: null, connectedAt: null, ip: null }),
  });
}

const api = (): typeof window.vela.vpn | undefined => (typeof window !== 'undefined' ? window.vela?.vpn : undefined);

let started = false;
function start(): void {
  if (started) return;
  started = true;
  const bridge = api();
  if (!bridge) return;
  bridge.onState(applyState);
  void bridge.state().then(applyState, () => undefined);
}

export const vpn = {
  setOpen(open: boolean): void {
    if (open === snapshot.open) return;
    start();
    emit(open ? { open, view: snapshot.mode !== 'signed-out' ? 'mantel' : 'providers', error: null } : { open });
    if (open && snapshot.mode !== 'signed-out') void api()?.state().then(applyState, () => undefined);
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
  /** Signs in with a Mantel account number (16 digits). Resolves to an error message or null. */
  async signIn(accountNumber: string): Promise<string | null> {
    const bridge = api();
    if (!bridge) return 'VPN is not available in this window.';
    emit({ checking: true, error: null });
    try {
      const result = await bridge.login(accountNumber);
      applyState(result.state);
      emit({ checking: false });
      return result.ok ? null : result.error;
    } catch {
      emit({ checking: false });
      return 'Something went wrong. Try again.';
    }
  },
  async signOut(): Promise<void> {
    clearPreviewTimer();
    const state = await api()?.logout().catch(() => undefined);
    if (state) applyState(state);
    emit({ view: 'providers', status: 'off', activeServerId: null, connectedAt: null, ip: null });
  },
  refresh(): void {
    void api()?.refresh().then(applyState, () => undefined);
  },
  selectServer(serverId: string): void {
    emit({ serverId, view: 'mantel' }, true);
    if (snapshot.status !== 'off') void vpn.connect();
  },
  toggleFavorite(serverId: string): void {
    const favorites = snapshot.favorites.includes(serverId)
      ? snapshot.favorites.filter((id) => id !== serverId)
      : [...snapshot.favorites, serverId];
    emit({ favorites }, true);
  },
  async connect(): Promise<void> {
    if (snapshot.mode === 'signed-out') return;
    clearPreviewTimer();
    const server = resolveServer(snapshot.servers, snapshot.serverId);
    if (!server) return;
    emit({ status: 'connecting', activeServerId: server.id, connectedAt: null, ip: null, error: null });
    if (snapshot.mode === 'preview') {
      previewTimer = window.setTimeout(() => {
        previewTimer = null;
        emit({ status: 'connected', connectedAt: Date.now(), ip: mockIp(server.id) });
      }, CONNECT_MS);
      return;
    }
    const result = await api()?.connect(server.id).catch(() => undefined);
    if (!result) {
      emit({ status: 'off', activeServerId: null, error: 'Something went wrong. Try again.' });
      return;
    }
    if (!result.ok) emit({ status: 'off', activeServerId: null, error: result.error });
    applyState(result.state);
  },
  disconnect(): void {
    clearPreviewTimer();
    emit({ status: 'off', activeServerId: null, connectedAt: null, ip: null });
    if (snapshot.mode === 'live') void api()?.disconnect().then(applyState, () => undefined);
  },
};
