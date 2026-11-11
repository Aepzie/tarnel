import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface JsonStore<T> {
  get(): T;
  set(next: T): void;
  update(fn: (current: T) => T): void;
  flush(): void;
}

const WRITE_DELAY_MS = 400;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;
const allStores = new Set<JsonStore<unknown>>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadFile<T>(file: string, defaults: T): T {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return defaults; // missing / unreadable: start fresh
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPlainObject(defaults)) {
      if (!isPlainObject(parsed)) throw new Error('shape mismatch');
      return { ...defaults, ...parsed } as T;
    }
    if (Array.isArray(defaults) && !Array.isArray(parsed)) throw new Error('shape mismatch');
    return parsed as T;
  } catch {
    try {
      fs.renameSync(file, `${file}.corrupt`);
    } catch {
      /* best effort */
    }
    return defaults;
  }
}

export function createStore<T>(name: string, defaults: T): JsonStore<T> {
  const file = path.join(app.getPath('userData'), `${name}.json`);
  let value = loadFile(file, defaults);
  let dirty = false;
  let timer: NodeJS.Timeout | null = null;
  let failures = 0;

  const writeNow = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return;
    dirty = false;
    const tmp = `${file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(value));
      fs.renameSync(tmp, file);
      failures = 0;
    } catch {
      // Retry with exponential backoff (1s, 2s, 4s … 30s) so a transient failure (AV lock,
      // full disk) does not silently lose data.
      dirty = true;
      failures += 1;
      timer = setTimeout(writeNow, Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1)));
      timer.unref?.();
    }
  };

  const schedule = (): void => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(writeNow, WRITE_DELAY_MS);
    timer.unref?.();
  };

  const store: JsonStore<T> = {
    get: () => value,
    set(next) {
      value = next;
      schedule();
    },
    update(fn) {
      value = fn(value);
      schedule();
    },
    flush: writeNow,
  };
  allStores.add(store as JsonStore<unknown>);
  return store;
}

const beforeFlushAll = new Set<() => void>();

/** Runs before every flushAllStores() (quit, update install): lets in-memory counters land in their store first. */
export function onBeforeFlushAll(hook: () => void): void {
  beforeFlushAll.add(hook);
}

export function flushAllStores(): void {
  for (const hook of beforeFlushAll) {
    try {
      hook();
    } catch {
      /* a failing hook must not block persisting the rest */
    }
  }
  for (const store of allStores) store.flush();
}
