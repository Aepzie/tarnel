/**
 * On-disk framing for the serialized adblock engine (pure: no electron, unit-tested).
 *
 * The file is `MAGIC <key> <space padding> \n <engine bytes>`. The key names everything the bytes
 * depend on (Ghostery serialization version, library version, list set), so a library upgrade or a
 * change of lists makes the old cache a miss instead of a deserialization error or, worse, a
 * silently stale engine. Ghostery's own ENGINE_VERSION check still runs on top as a second line of
 * defence. The padding makes the engine bytes start 8-byte aligned: Ghostery deserializes through
 * typed-array views (Uint32Array, ...) that throw on an unaligned offset.
 */

const MAGIC = 'VELA-ADB1 ';
const NEWLINE = 0x0a;
const MAX_HEADER = 512;
const ALIGN = 8;

export interface CacheKeyParts {
  engineVersion: number;
  libraryVersion: string;
  lists: string;
}

export function cacheKey(parts: CacheKeyParts): string {
  return `engine=${parts.engineVersion};lib=${parts.libraryVersion};lists=${parts.lists}`;
}

export function encodeCache(key: string, engine: Uint8Array): Uint8Array {
  const line = `${MAGIC}${key}`;
  const padded = line.padEnd(Math.ceil((line.length + 1) / ALIGN) * ALIGN - 1, ' ');
  const header = new TextEncoder().encode(`${padded}\n`);
  const out = new Uint8Array(header.length + engine.length);
  out.set(header, 0);
  out.set(engine, header.length);
  return out;
}

/** The engine bytes if the file carries exactly `key`; null for a foreign, old or truncated file. */
export function decodeCache(key: string, file: Uint8Array): Uint8Array | null {
  const end = file.subarray(0, MAX_HEADER).indexOf(NEWLINE);
  if (end < 0) return null;
  const header = new TextDecoder().decode(file.subarray(0, end)).trimEnd();
  if (header !== `${MAGIC}${key}`) return null;
  const body = file.subarray(end + 1);
  if (body.length === 0) return null;
  // Files written before the header was padded (or read into an offset buffer) start unaligned.
  return body.byteOffset % ALIGN === 0 ? body : body.slice();
}
