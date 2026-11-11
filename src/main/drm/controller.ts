import type { DrmFailure, DrmStatus } from '../../shared/drm';
import { drmLaunchPolicy } from './policy';

/** Stable Castlabs v45 components API; absent in stock Electron. */
export interface CdmComponent {
  status: string;
  title: string | null;
  version: string | null;
}
export interface CdmComponents {
  readonly WIDEVINE_CDM_ID: string;
  updatesEnabled: boolean;
  status(): Record<string, CdmComponent>;
  whenReady(required?: string[]): Promise<(CdmComponent & { id: string })[]>;
}
export interface DrmControllerOptions {
  enabled: boolean;
  components: CdmComponents | null;
  platform: string;
  arch: string;
  probe(): Promise<boolean>;
  changed(status: DrmStatus): void;
  timeoutMs?: number;
  startupBlocked?: boolean;
}
export class DrmController {
  private enabled: boolean;
  private readonly launch;
  private version: string | null = null;
  private eme = false;
  private pending: Promise<void> | null = null;
  private initializing = false;
  private failure: DrmFailure = null;
  private revoked = false;
  private componentRestart = false;

  constructor(private readonly options: DrmControllerOptions) {
    this.enabled = options.enabled;
    this.launch = drmLaunchPolicy(options.enabled, !!options.components, options.platform, options.arch);
  }
  status(): DrmStatus {
    const restartRequired = !!this.options.components && this.launch.supported &&
      (this.enabled !== this.launch.enabled || this.revoked || this.componentRestart);
    const failure = this.enabled && !this.options.components ? 'runtime-missing' : this.failure;
    let state: DrmStatus['state'];
    if (!this.launch.supported) state = 'unsupported';
    else if (restartRequired) state = 'restart-required';
    else if (!this.enabled) state = 'disabled';
    else if (failure) state = 'unavailable';
    else if (this.initializing) state = 'initializing';
    else state = this.eme ? 'available' : 'unavailable';
    return {
      enabled: this.enabled, enabledAtStartup: this.launch.enabled, state,
      runtime: this.options.components ? 'castlabs' : 'standard', componentVersion: this.version,
      emeAvailable: this.eme, restartRequired, failure,
      platform: this.options.platform, serviceVerified: false,
    };
  }
  private emit(): void { this.options.changed(this.status()); }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled && this.launch.enabled) {
      this.revoked = true;
      // No documented cancellation for a download already in flight. A restart finishes shutdown.
      try { if (this.options.components) this.options.components.updatesEnabled = false; } catch { /* stay denied */ }
    }
    this.emit();
  }

  start(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.initialize();
    return this.pending;
  }

  private async initialize(): Promise<void> {
    const api = this.options.components;
    if (!api || !this.launch.enabled) return;
    if (this.options.startupBlocked) { this.failure = 'startup-blocked'; this.emit(); return; }
    this.initializing = true;
    this.emit();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error('timeout')); }, this.options.timeoutMs ?? 30_000);
    });
    try {
      const previous = api.status()[api.WIDEVINE_CDM_ID]?.version;
      api.updatesEnabled = true;
      const result = await Promise.race([api.whenReady([api.WIDEVINE_CDM_ID]), timeout]);
      if (!this.enabled || this.revoked) return;
      const cdm = result.find((item) => item.id === api.WIDEVINE_CDM_ID);
      const version = cdm?.version;
      // ECS v45 reports an already installed component as "new" on a warm start.
      // Availability still requires creating MediaKeys in the native EME probe below.
      if (!version || !/^\d+(?:\.\d+){1,4}$/.test(version) || !['new', 'updated', 'up-to-date'].includes(cdm.status)) {
        this.failure = 'component-failed';
        return;
      }
      this.version = version;
      const available = await Promise.race([this.options.probe(), timeout]);
      if (!this.enabled || this.revoked) return;
      this.eme = available;
      if (!available) {
        // Stable ECS v45 on Linux registers a newly installed CDM only at the next launch.
        this.componentRestart = this.options.platform === 'linux' && !previous;
        this.failure = 'eme-unavailable';
      }
    } catch {
      this.failure = expired ? 'component-timeout' : 'component-failed';
    } finally {
      if (timer) clearTimeout(timer);
      this.initializing = false;
      this.emit();
    }
  }
}
