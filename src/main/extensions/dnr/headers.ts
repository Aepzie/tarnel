import type { ModifyHeaderInfo } from './types';

/**
 * modifyHeaders application with Chrome's conflict rules. Operations arrive in precedence order
 * (most recently installed extension first, then rule priority). Per header:
 * - the first operation applies;
 * - after a `remove`, nothing else applies;
 * - after a `set`, only `append`s of the same extension apply;
 * - after an `append`, further `append`s (any extension) apply, `set` / `remove` don't.
 */

export interface HeaderOpEntry {
  extensionId: string;
  op: ModifyHeaderInfo;
}

interface HeaderState {
  operation: ModifyHeaderInfo['operation'];
  extensionId: string;
}

function allowed(state: HeaderState | undefined, entry: HeaderOpEntry): boolean {
  if (!state) return true;
  if (state.operation === 'remove') return false;
  if (entry.op.operation !== 'append') return false;
  return state.operation === 'append' || state.extensionId === entry.extensionId;
}

function keysOf(headers: Record<string, unknown>, lowerName: string): string[] {
  return Object.keys(headers).filter((key) => key.toLowerCase() === lowerName);
}

/** Electron request headers: one string per name. */
export function applyRequestHeaderOps(headers: Record<string, string>, entries: readonly HeaderOpEntry[]): void {
  const states = new Map<string, HeaderState>();
  for (const entry of entries) {
    const name = entry.op.header;
    const state = states.get(name);
    if (!allowed(state, entry)) continue;
    const existing = keysOf(headers, name);
    if (entry.op.operation === 'remove') {
      for (const key of existing) delete headers[key];
    } else if (entry.op.operation === 'set') {
      for (const key of existing) delete headers[key];
      headers[existing[0] ?? name] = entry.op.value!;
    } else {
      const key = existing[0];
      const separator = name === 'cookie' ? '; ' : ', ';
      if (key !== undefined && headers[key]) headers[key] = `${headers[key]}${separator}${entry.op.value!}`;
      else headers[key ?? name] = entry.op.value!;
    }
    if (!state) states.set(name, { operation: entry.op.operation, extensionId: entry.extensionId });
  }
}

/** Electron response headers: a list of values per name. */
export function applyResponseHeaderOps(headers: Record<string, string[]>, entries: readonly HeaderOpEntry[]): void {
  const states = new Map<string, HeaderState>();
  for (const entry of entries) {
    const name = entry.op.header;
    const state = states.get(name);
    if (!allowed(state, entry)) continue;
    const existing = keysOf(headers, name);
    if (entry.op.operation === 'remove') {
      for (const key of existing) delete headers[key];
    } else if (entry.op.operation === 'set') {
      for (const key of existing) delete headers[key];
      headers[existing[0] ?? name] = [entry.op.value!];
    } else {
      const key = existing[0] ?? name;
      headers[key] = [...(headers[key] ?? []), entry.op.value!];
    }
    if (!state) states.set(name, { operation: entry.op.operation, extensionId: entry.extensionId });
  }
}
