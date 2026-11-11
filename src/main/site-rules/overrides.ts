import type { WebContents } from 'electron';
import type { RuleFingerprintLevel } from '../../shared/site-rules';

/**
 * Per-tab overrides set by site rules at navigation time. Keyed by the tab's WebContents, so they die
 * with it (moving a tab to another Space or VPN route recreates the WebContents and starts clean).
 * Read by fingerprint/index.ts (config per frame) and user-agent.ts (skip tabs with their own UA).
 */

export interface FingerprintOverride {
  level: RuleFingerprintLevel;
  /** Fresh seed for 'random' (one per site visit); null = the Space's seed. */
  seed: string | null;
  /** Host the random seed was made for. */
  host: string;
}

const fingerprintOverrides = new WeakMap<WebContents, FingerprintOverride>();
const userAgentOverrides = new WeakMap<WebContents, string>();

export function fingerprintOverrideOf(wc: WebContents): FingerprintOverride | null {
  return fingerprintOverrides.get(wc) ?? null;
}

export function setFingerprintOverride(wc: WebContents, override: FingerprintOverride | null): void {
  if (override) fingerprintOverrides.set(wc, override);
  else fingerprintOverrides.delete(wc);
}

export function userAgentOverrideOf(wc: WebContents): string | null {
  return userAgentOverrides.get(wc) ?? null;
}

export function setUserAgentOverride(wc: WebContents, value: string | null): void {
  if (value) userAgentOverrides.set(wc, value);
  else userAgentOverrides.delete(wc);
}
