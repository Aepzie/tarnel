/** Fire-and-forget IPC: the identity preload reports the real high-entropy UA client hints once per renderer. */
export const IDENTITY_HINTS_CHANNEL = 'vela:identity-hints';

/** NavigatorUAData.getHighEntropyValues() keys mirrored into Sec-CH-UA-* request headers. */
export const HIGH_ENTROPY_HINTS = ['architecture', 'bitness', 'fullVersionList', 'model', 'platformVersion', 'uaFullVersion', 'wow64'] as const;

/** The resolved value of getHighEntropyValues(HIGH_ENTROPY_HINTS): the low-entropy fields are always included. */
export interface IdentityHints {
  brands: { brand: string; version: string }[];
  mobile: boolean;
  platform: string;
  architecture: string;
  bitness: string;
  fullVersionList: { brand: string; version: string }[];
  model: string;
  platformVersion: string;
  uaFullVersion: string;
  wow64: boolean;
}
