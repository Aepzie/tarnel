/** Synchronous IPC asked by the fingerprint preload in every frame before page scripts run. */
export const FINGERPRINT_CONFIG_CHANNEL = 'vela:fingerprint-config';

/**
 * What the main world patch needs. Derived in main from the space seed (never sent to pages) and
 * the frame's top-level site, so values are stable per site but differ between Spaces.
 */
export interface FingerprintConfig {
  strict: boolean;
  /** Four unsigned 32-bit words: HMAC(space seed, top-level site). Drives all noise. */
  key: number[];
  /** navigator.hardwareConcurrency. Per space, not per site (real hardware does not change per site). */
  cores: number;
  /** navigator.deviceMemory (GiB), consistent with the Device-Memory client hint. */
  memory: number;
  /** Index into the generic GPU model list for the real GPU vendor. */
  gpu: number;
}
