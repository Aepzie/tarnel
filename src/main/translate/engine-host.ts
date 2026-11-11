import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import type { EngineReply, EngineRequest, ModelPaths } from './engine-protocol';

/** The engine holds ~300 MB with one model pair loaded: give it back soon after the last use. */
const IDLE_EXIT_MS = 3 * 60_000;

type Pending = { resolve: (reply: EngineReply & { ok: true }) => void; reject: (error: Error) => void };
type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;

let child: UtilityProcess | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const loaded = new Set<string>();
let idleTimer: NodeJS.Timeout | null = null;

function vendorDir(): string {
  return path.join(__dirname, '..', 'vendor', 'bergamot');
}

function failAll(message: string): void {
  for (const entry of pending.values()) entry.reject(new Error(message));
  pending.clear();
}

function spawn(): UtilityProcess {
  if (child) return child;
  const proc = utilityProcess.fork(path.join(__dirname, 'translate-engine.js'), [vendorDir()], {
    serviceName: 'Vela Translation',
    stdio: 'ignore',
  });
  proc.on('message', (reply: EngineReply) => {
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    if (reply.ok) entry.resolve(reply);
    else entry.reject(new Error(reply.error));
  });
  proc.on('exit', () => {
    if (child === proc) child = null;
    loaded.clear();
    failAll('Translation engine stopped');
  });
  child = proc;
  return proc;
}

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(stopEngine, IDLE_EXIT_MS);
  idleTimer.unref();
}

function request(message: Distribute<EngineRequest>): Promise<EngineReply & { ok: true }> {
  const proc = spawn();
  touch();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    proc.postMessage({ ...message, id });
  });
}

export async function ensureModel(key: string, files: ModelPaths): Promise<void> {
  if (loaded.has(key) && child) return;
  await request({ type: 'load', key, files });
  loaded.add(key);
}

export async function unloadModel(key: string): Promise<void> {
  if (!child || !loaded.has(key)) return;
  loaded.delete(key);
  await request({ type: 'unload', key });
}

export async function translateTexts(chain: string[], texts: string[]): Promise<string[]> {
  if (!texts.length) return [];
  const reply = await request({ type: 'translate', chain, texts });
  return reply.texts ?? [];
}

/** Resident memory of the engine process in bytes (null when it isn't running). */
export async function engineMemory(): Promise<number | null> {
  if (!child) return null;
  return (await request({ type: 'memory' })).rss ?? null;
}

export function engineRunning(): boolean {
  return child !== null;
}

export function stopEngine(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const proc = child;
  child = null;
  loaded.clear();
  failAll('Translation engine stopped');
  proc?.kill();
}
