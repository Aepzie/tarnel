import type { Session, WebContents } from 'electron';
import { FINGERPRINT_WORKER_CONFIG_CHANNEL, type FingerprintConfig } from '../../shared/fingerprint';
import { protectMainWorld } from '../../preload/fingerprint-main-world';

/**
 * Fingerprint protection for workers. Workers have no frame preloads, so they would report the real
 * hardwareConcurrency, GPU and unnoised OffscreenCanvas next to a patched window, which itself is a
 * tell (CreepJS: "does not match worker scope"). The same `protectMainWorld` source runs in them:
 *
 *  - dedicated workers (classic, module, blob:, data:, nested) and shared workers: through the tab's
 *    own DevTools protocol client (`webContents.debugger`). Auto-attach with waitForDebuggerOnStart
 *    holds every new worker before its first script statement, `Runtime.evaluate` patches its global
 *    scope, then it resumes. No script is rewritten, so module workers, importScripts, relative URLs
 *    and CSP behave natively. Shared workers are not children of a page: they are discovered and
 *    attached on creation (before their script is fetched and run);
 *  - service workers: a `service-worker` session preload (preload/fingerprint-worker.ts), which runs
 *    before the worker script and works without any open tab.
 *
 * Only Runtime.evaluate / Target commands are used: no Runtime/Debugger domain is enabled, so pages
 * cannot observe the client, and nothing at all is attached in Spaces with protection 'off'.
 */

export type ConfigLookup = (session: Session, url: string) => FingerprintConfig | null;

/** Timezone / ICU locale a tab's renderers use; null fields = the system's. */
export interface EmulationSettings {
  timezone: string | null;
  locale: string | null;
}

export interface WorkerGuard {
  stop: () => void;
  /** Re-applies the current emulation settings (Space changed, or another tab released a shared renderer). */
  refresh: () => void;
}

type CdpParams = Record<string, unknown>;

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
  attached?: boolean;
  browserContextId?: string;
}

const PATCH_SOURCE = protectMainWorld.toString();

/** Service workers are left to the session preload (they also start without any tab). */
const AUTO_ATTACH = {
  autoAttach: true,
  waitForDebuggerOnStart: true,
  flatten: true,
  filter: [{ type: 'service_worker', exclude: true }, {}],
};

/** A shared worker is shared by every tab of a site: the first tab that sees it patches it. */
const claimedSharedWorkers = new Set<string>();

const WORKER_TYPES = new Set(['worker', 'shared_worker']);

function patchExpression(config: FingerprintConfig): string {
  return `(${PATCH_SOURCE})(${JSON.stringify(config)})`;
}

/**
 * Patches every dedicated and shared worker created by `wc` (and its iframes, and their workers)
 * until the returned function is called. Returns null if the tab's debugger is unavailable (another
 * client owns it): workers then stay unpatched, like before.
 */
export function protectWorkersOf(wc: WebContents, lookup: ConfigLookup, emulation: () => EmulationSettings): WorkerGuard | null {
  const client = wc.debugger;
  if (client.isAttached()) return null;
  try {
    client.attach('1.3');
  } catch {
    return null;
  }

  const ownSharedWorkers = new Set<string>();
  let browserContextId: string | undefined;

  const send = (method: string, params: CdpParams = {}, sessionId?: string): void => {
    client.sendCommand(method, params, sessionId).catch(() => undefined);
  };

  const pageUrl = (): string => {
    try {
      return wc.mainFrame.url || wc.getURL();
    } catch {
      return wc.getURL();
    }
  };

  /**
   * Resumes a held frame once its own auto-attach is set up (so its workers are held too). A resume
   * sent before the frame's setAutoAttach has answered (it answers once the frame's navigation
   * commits) is lost and the out-of-process iframe stays paused. A worker's session handles its
   * commands in order, so workers are resumed right away (patch, auto-attach, resume).
   */
  const watchAndResume = (child: string): void => {
    emulate(child);
    const resume = (): void => send('Runtime.runIfWaitingForDebugger', {}, child);
    client.sendCommand('Target.setAutoAttach', AUTO_ATTACH, child).then(resume, resume);
  };

  /**
   * Native timezone / locale override (Emulation domain): Chromium applies it to the renderer
   * process, so the page, its same-process iframes and every dedicated worker of that process agree,
   * including Date, Intl and toLocale*. Out-of-process iframes get it on their own session. The
   * override is process-wide: a second tab sharing the renderer gets "already in effect" (same
   * Space, same value), and refresh() re-claims it when the owning tab goes away.
   */
  const emulate = (sessionId?: string): void => {
    const settings = emulation();
    send('Emulation.setTimezoneOverride', { timezoneId: settings.timezone ?? '' }, sessionId);
    send('Emulation.setLocaleOverride', settings.locale ? { locale: settings.locale } : {}, sessionId);
  };
  const frameSessions = new Set<string>();

  const onAttached = (params: CdpParams, parentSession: string | undefined): void => {
    const child = params.sessionId as string;
    const target = params.targetInfo as TargetInfo;
    if (WORKER_TYPES.has(target.type)) {
      const config = lookup(wc.session, pageUrl());
      if (config) send('Runtime.evaluate', { expression: patchExpression(config), silent: true }, child);
      send('Target.setAutoAttach', AUTO_ATTACH, child);
      send('Runtime.runIfWaitingForDebugger', {}, child);
    } else if (target.type === 'iframe' || target.type === 'page') {
      frameSessions.add(child);
      watchAndResume(child);
    } else {
      send('Runtime.runIfWaitingForDebugger', {}, child);
      send('Target.detachFromTarget', { sessionId: child }, parentSession);
    }
  };

  /**
   * Every tab of the Space sees the creation; the one that has a document of the worker's origin
   * (its creator, in practice) claims it, so a third-party shared worker gets the key of the top
   * site that embeds it (it is partitioned by that site anyway), like its creating frame.
   */
  const hostsOrigin = (workerUrl: string): boolean => {
    let origin: string;
    try {
      const url = new URL(workerUrl);
      origin = url.protocol === 'blob:' ? new URL(url.pathname).origin : url.origin;
    } catch {
      return false;
    }
    if (origin === 'null') return true;
    try {
      return wc.mainFrame.framesInSubtree.some((frame) => frame.origin === origin);
    } catch {
      return false;
    }
  };

  const onSharedWorkerCreated = (target: TargetInfo): void => {
    if (target.attached || claimedSharedWorkers.has(target.targetId)) return;
    if (!browserContextId || target.browserContextId !== browserContextId || !hostsOrigin(target.url)) return;
    claimedSharedWorkers.add(target.targetId);
    ownSharedWorkers.add(target.targetId);
    send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  };

  const forgetSharedWorker = (targetId: string): void => {
    if (!ownSharedWorkers.delete(targetId)) return;
    claimedSharedWorkers.delete(targetId);
  };

  const onMessage = (_event: unknown, method: string, params: CdpParams, sessionId?: string): void => {
    try {
      if (method === 'Target.attachedToTarget') onAttached(params, sessionId);
      else if (method === 'Target.targetCreated') {
        const target = params.targetInfo as TargetInfo;
        if (target.type === 'shared_worker') onSharedWorkerCreated(target);
      } else if (method === 'Target.targetDestroyed') forgetSharedWorker(params.targetId as string);
      else if (method === 'Target.detachedFromTarget') frameSessions.delete(params.sessionId as string);
    } catch {
      /* never break the tab */
    }
  };

  const release = (): void => {
    client.off('message', onMessage);
    client.off('detach', release);
    for (const targetId of ownSharedWorkers) claimedSharedWorkers.delete(targetId);
    ownSharedWorkers.clear();
  };

  client.on('message', onMessage);
  client.on('detach', release);
  emulate();
  send('Target.setAutoAttach', AUTO_ATTACH);
  client
    .sendCommand('Target.getTargetInfo')
    .then((info: { targetInfo?: TargetInfo }) => {
      browserContextId = info.targetInfo?.browserContextId;
      send('Target.setDiscoverTargets', { discover: true, filter: [{ type: 'shared_worker' }] });
    })
    .catch(() => undefined);

  const stop = (): void => {
    release();
    try {
      if (!wc.isDestroyed() && client.isAttached()) client.detach();
    } catch {
      /* already gone */
    }
  };
  const refresh = (): void => {
    if (wc.isDestroyed() || !client.isAttached()) return;
    emulate();
    for (const sessionId of frameSessions) emulate(sessionId);
  };
  return { stop, refresh };
}

/**
 * Answers the service-worker preload's synchronous config request. Electron delivers it only to the
 * worker's own `ServiceWorkerMain.ipc`, which exists from the 'starting' status on (emitted before
 * the worker thread runs its preload), so every starting worker gets a handler that always replies:
 * an unanswered sendSync would hang the worker.
 */
export function answerServiceWorkers(session: Session, lookup: ConfigLookup): void {
  const workers = session.serviceWorkers;
  workers.on('running-status-changed', ({ versionId, runningStatus }) => {
    if (runningStatus !== 'starting') return;
    const worker = workers.getWorkerFromVersionID(versionId);
    if (!worker || worker.ipc.listenerCount(FINGERPRINT_WORKER_CONFIG_CHANNEL) > 0) return;
    worker.ipc.on(FINGERPRINT_WORKER_CONFIG_CHANNEL, (event) => {
      try {
        event.returnValue = /^https?:/i.test(worker.scope) ? lookup(session, worker.scope) : null;
      } catch {
        event.returnValue = null;
      }
    });
  });
}
