import { createHmac, randomBytes } from 'node:crypto';
import type { Space, SpaceId } from '../../shared/types';
import { createStore, type JsonStore } from '../store';

interface SeedsFile {
  seeds: Record<SpaceId, string>;
}

const SEED_PATTERN = /^[0-9a-f]{64}$/;

let store: JsonStore<SeedsFile> | null = null;
/** Burner seeds live in memory only, so every launch (and every new Burner) gets a fresh identity. */
const ephemeralSeeds = new Map<SpaceId, string>();

function requireStore(): JsonStore<SeedsFile> {
  store ??= createStore<SeedsFile>('fingerprint', { seeds: {} });
  return store;
}

function freshSeed(): string {
  return randomBytes(32).toString('hex');
}

export function seedFor(space: Space): string {
  if (space.ephemeral) {
    const known = ephemeralSeeds.get(space.id);
    if (known) return known;
    const seed = freshSeed();
    ephemeralSeeds.set(space.id, seed);
    return seed;
  }
  const known = requireStore().get().seeds?.[space.id];
  if (typeof known === 'string' && SEED_PATTERN.test(known)) return known;
  const seed = freshSeed();
  requireStore().update((file) => ({ seeds: { ...file.seeds, [space.id]: seed } }));
  return seed;
}

/**
 * New random seed for `space`. `score` rates a candidate (higher = more values differ from the old
 * identity); the best of a few candidates wins, so small value sets (CPU cores, GPU model) don't
 * stay the same by chance.
 */
export function regenerateSeed(space: Space, score: (seed: string) => number = () => 0): void {
  let seed = freshSeed();
  let best = score(seed);
  for (let i = 0; i < 31; i++) {
    const candidate = freshSeed();
    const value = score(candidate);
    if (value > best) [seed, best] = [candidate, value];
  }
  if (space.ephemeral) ephemeralSeeds.set(space.id, seed);
  else requireStore().update((file) => ({ seeds: { ...file.seeds, [space.id]: seed } }));
}

/** Drops seeds of removed spaces. */
export function pruneSeeds(live: ReadonlySet<SpaceId>): void {
  for (const id of ephemeralSeeds.keys()) if (!live.has(id)) ephemeralSeeds.delete(id);
  const seeds = requireStore().get().seeds ?? {};
  const stale = Object.keys(seeds).filter((id) => !live.has(id));
  if (stale.length === 0) return;
  requireStore().update((file) => ({
    seeds: Object.fromEntries(Object.entries(file.seeds).filter(([id]) => live.has(id))),
  }));
}

/** Four unsigned 32-bit words of HMAC-SHA256(seed, label). */
export function deriveWords(seed: string, label: string): number[] {
  const digest = createHmac('sha256', Buffer.from(seed, 'hex')).update(label).digest();
  return [0, 4, 8, 12].map((offset) => digest.readUInt32LE(offset));
}
