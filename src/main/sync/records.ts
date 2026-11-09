/**
 * Sync data model: a flat map of records, merged per key with last-writer-wins.
 *
 * Keys are namespaced: `s/<setting>`, `sp/<space sync id>`, `t/<device id>` (that device's open tabs),
 * `h/<url hash>`. A record with `v === null` is a tombstone (deletion) and is kept so the deletion
 * wins over older copies still sitting in other devices' files.
 */
export interface SyncRecord {
  k: string;
  v: unknown;
  /** Hybrid logical clock: max(wall time, last seen clock + 1). */
  c: number;
  /** Writer device id; breaks ties so every device picks the same winner. */
  d: string;
}

export function isNewer(candidate: SyncRecord, current: SyncRecord | undefined): boolean {
  if (!current) return true;
  if (candidate.c !== current.c) return candidate.c > current.c;
  return candidate.d > current.d;
}

export function isRecord(value: unknown): value is SyncRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<SyncRecord>;
  return (
    typeof r.k === 'string' && r.k.length > 0 && r.k.length <= 512 &&
    typeof r.c === 'number' && Number.isFinite(r.c) &&
    typeof r.d === 'string' && r.d.length <= 64 &&
    'v' in r
  );
}

/** Applies every incoming record that beats the local copy; returns the adopted ones. */
export function mergeRecords(db: Map<string, SyncRecord>, incoming: readonly SyncRecord[]): SyncRecord[] {
  const adopted: SyncRecord[] = [];
  for (const record of incoming) {
    if (!isRecord(record) || !isNewer(record, db.get(record.k))) continue;
    db.set(record.k, record);
    adopted.push(record);
  }
  return adopted;
}

export class HybridClock {
  constructor(private last = 0) {}

  get value(): number {
    return this.last;
  }

  tick(): number {
    this.last = Math.max(Date.now(), this.last + 1);
    return this.last;
  }

  observe(clock: number): void {
    if (Number.isFinite(clock) && clock > this.last) this.last = clock;
  }
}

/** JSON with sorted object keys: equal values always serialize identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    return Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}
