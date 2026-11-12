import { app } from 'electron';
import { frameRateFeatures } from './frame-rate';
import { shouldDisableStockComponentUpdates } from '../drm/startup';

/**
 * Chromium command-line tuning. Must run before `app` emits 'ready'.
 *
 * Policy: only switches that are stable in current Chromium and safe on every GPU/driver. Anything
 * that bypasses the GPU blocklist (ignore-gpu-blocklist, forced gpu-rasterization / zero-copy) or
 * defeats Chromium's own power management (disable-renderer-backgrounding,
 * disable-background-timer-throttling, disable-backgrounding-occluded-windows) is deliberately
 * NOT used. Rationale for every entry lives in docs/PERFORMANCE.md.
 *
 * Set VELA_NO_FLAGS=1 to launch with stock Electron switches (useful to bisect a site bug).
 */

/** Features turned on. */
const ENABLE_FEATURES: readonly string[] = [
  // Split large downloads into concurrent range requests when the server supports it.
  // Off by default on desktop Chromium, but lives in the shared download component used by Electron.
  'ParallelDownloading',
];

/**
 * Features turned off. Most are Chrome-browser services that phone home or run background work we
 * never use. Several are not compiled into Electron at all; listing them is a cheap guarantee that
 * they stay off if a future Electron version starts including them.
 */
const DISABLE_FEATURES: readonly string[] = [
  'MediaRouter', // Cast discovery: mDNS/SSDP scanning on the LAN, wakes the network stack.
  'DialMediaRouteProvider', // Same, DIAL protocol.
  'OptimizationHints', // Fetches per-site hints from Google.
  'Translate', // Translate UI/language detection model; we ship no translate UI.
  'AutofillServerCommunication', // Uploads form signatures to Google.
  'InterestFeedContentSuggestions', // NTP feed; our new tab is local.
];

/** Plain switches (no value). */
const SWITCHES: readonly string[] = [
  // Ignore <a ping> hyperlink auditing: one less tracking request per click (Firefox does the same).
  'no-pings',
  // Domain Reliability uploads network error beacons to Google domains.
  'disable-domain-reliability',
];

function mergeList(switchName: string, additions: readonly string[]): void {
  const existing = app.commandLine.hasSwitch(switchName)
    ? app.commandLine.getSwitchValue(switchName).split(',').filter(Boolean)
    : [];
  const merged = [...new Set([...existing, ...additions])];
  app.commandLine.appendSwitch(switchName, merged.join(','));
}

export function applyChromiumFlags(hasCdmRuntime = false): void {
  if (shouldDisableStockComponentUpdates(hasCdmRuntime, process.env.VELA_NO_FLAGS === '1')) {
    app.commandLine.appendSwitch('disable-component-update');
  }
  if (process.env.VELA_NO_FLAGS === '1') return;

  for (const name of SWITCHES) app.commandLine.appendSwitch(name);

  // Merge rather than overwrite: Chromium only honours the last --enable-features / --disable-features,
  // so clobbering a value set elsewhere (or by the user on the command line) would silently drop it.
  // Frame pacing on mixed-refresh Windows setups (Settings → Performance → Frame rate, see frame-rate.ts).
  mergeList('enable-features', [...ENABLE_FEATURES, ...frameRateFeatures()]);
  mergeList('disable-features', DISABLE_FEATURES);
  keepBackgroundThrottling();
}

/**
 * Switches that would defeat background throttling. Hidden tabs must keep Chromium's timer budget
 * (1 wake-up/s) and intensive wake-up throttling (1 wake-up/min for chained timers after 5 min).
 */
const THROTTLING_KILLERS: readonly string[] = [
  'disable-background-timer-throttling',
  'disable-renderer-backgrounding',
  'disable-backgrounding-occluded-windows',
];

/** Features that must stay on for background tabs (on by default; listed so they stay on). */
const THROTTLING_FEATURES: readonly string[] = ['IntensiveWakeUpThrottling'];

function keepBackgroundThrottling(): void {
  for (const name of THROTTLING_KILLERS) {
    if (app.commandLine.hasSwitch(name)) app.commandLine.removeSwitch(name);
  }
  const disabled = app.commandLine.hasSwitch('disable-features')
    ? app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean)
    : [];
  const kept = disabled.filter((feature) => !THROTTLING_FEATURES.includes(feature.split(':')[0]));
  if (kept.length !== disabled.length) app.commandLine.appendSwitch('disable-features', kept.join(','));
  mergeList('enable-features', THROTTLING_FEATURES);
}
