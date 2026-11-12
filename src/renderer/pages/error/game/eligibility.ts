const NETWORK_ERRORS = new Set([
  'ERR_NAME_NOT_RESOLVED', 'ERR_NAME_RESOLUTION_FAILED', 'ERR_NETWORK_CHANGED',
  'ERR_ADDRESS_UNREACHABLE', 'ERR_CONNECTION_TIMED_OUT', 'ERR_TIMED_OUT',
  'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ERR_EMPTY_RESPONSE',
]);

/** OS connectivity is only a hint; an explicit Chromium disconnect remains authoritative. */
export function canPlayOffline(code: string, online: boolean): boolean {
  return code === 'ERR_INTERNET_DISCONNECTED' || (!online && NETWORK_ERRORS.has(code));
}
