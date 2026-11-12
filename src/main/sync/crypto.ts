import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Sync blob format (all integers big-endian):
 *
 *   "VELASYNC" (8) | version u8 | header length u16 | header JSON (utf8) | nonce (12) | ciphertext | GCM tag (16)
 *
 * Everything before the nonce is plaintext but authenticated (AES-256-GCM additional data), so the
 * header (format version, blob kind, device id) cannot be altered or swapped between blobs.
 */
const MAGIC = Buffer.from('VELASYNC', 'ascii');
const FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX_BYTES = MAGIC.length + 1 + 2;
const MAX_HEADER_BYTES = 4096;
export const KEY_BYTES = 32;

export interface KdfParams {
  name: 'scrypt';
  /** CPU/memory cost (power of two). 2^17 ≈ 128 MiB, a few hundred ms. */
  N: number;
  r: number;
  p: number;
  /** base64, 16 random bytes. */
  salt: string;
}

export interface BlobHeader {
  v: number;
  kind: 'key' | 'check' | 'changes';
  /** Writer's random device id ('' for key material). */
  device: string;
  kdf?: KdfParams;
}

/** Thrown for every authentication / decoding failure; the message is safe to show. */
export class SyncCryptoError extends Error {
  override name = 'SyncCryptoError';
}

export const DEFAULT_KDF = { N: 2 ** 17, r: 8, p: 1 } as const;

export function newKdfParams(): KdfParams {
  return { name: 'scrypt', ...DEFAULT_KDF, salt: randomBytes(16).toString('base64') };
}

/** Rejects absurd parameters from a (possibly hostile) remote key file before spending CPU/RAM on them. */
export function validKdf(kdf: unknown): kdf is KdfParams {
  if (!kdf || typeof kdf !== 'object') return false;
  const k = kdf as Partial<KdfParams>;
  return (
    k.name === 'scrypt' &&
    typeof k.N === 'number' && Number.isInteger(Math.log2(k.N)) && k.N >= 2 ** 14 && k.N <= 2 ** 20 &&
    typeof k.r === 'number' && Number.isInteger(k.r) && k.r >= 8 && k.r <= 16 &&
    typeof k.p === 'number' && Number.isInteger(k.p) && k.p >= 1 && k.p <= 4 &&
    typeof k.salt === 'string' && Buffer.from(k.salt, 'base64').length >= 16
  );
}

export function deriveKey(passphrase: string, kdf: KdfParams): Promise<Buffer> {
  const options: ScryptOptions = { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 + 16 * 1024 * 1024 };
  const secret = Buffer.from(passphrase.normalize('NFKC'), 'utf8');
  return new Promise((resolve, reject) => {
    scryptCb(secret, Buffer.from(kdf.salt, 'base64'), KEY_BYTES, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export function seal(key: Buffer, header: BlobHeader, plaintext: Buffer): Buffer {
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  if (headerBytes.length > MAX_HEADER_BYTES) throw new Error('Sync header too large');
  const prefix = Buffer.alloc(PREFIX_BYTES);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt8(FORMAT_VERSION, MAGIC.length);
  prefix.writeUInt16BE(headerBytes.length, MAGIC.length + 1);
  const aad = Buffer.concat([prefix, headerBytes]);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([aad, nonce, body, cipher.getAuthTag()]);
}

/** Parses the (unauthenticated!) header. Only use it to route a blob, never to trust it. */
export function peekHeader(blob: Buffer): { header: BlobHeader; aadLength: number } {
  if (blob.length < PREFIX_BYTES + NONCE_BYTES + TAG_BYTES || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new SyncCryptoError('Not a Tarnel sync file');
  }
  if (blob.readUInt8(MAGIC.length) !== FORMAT_VERSION) throw new SyncCryptoError('Unsupported sync format version');
  const headerLength = blob.readUInt16BE(MAGIC.length + 1);
  const aadLength = PREFIX_BYTES + headerLength;
  if (headerLength > MAX_HEADER_BYTES || blob.length < aadLength + NONCE_BYTES + TAG_BYTES) throw new SyncCryptoError('Truncated sync file');
  let header: BlobHeader;
  try {
    header = JSON.parse(blob.subarray(PREFIX_BYTES, aadLength).toString('utf8')) as BlobHeader;
  } catch {
    throw new SyncCryptoError('Corrupted sync header');
  }
  if (!header || typeof header !== 'object' || header.v !== FORMAT_VERSION || typeof header.device !== 'string') {
    throw new SyncCryptoError('Corrupted sync header');
  }
  return { header, aadLength };
}

/** Decrypts and authenticates a blob. Throws SyncCryptoError on a wrong key or any tampering. */
export function open(key: Buffer, blob: Buffer, expectKind: BlobHeader['kind']): { header: BlobHeader; plaintext: Buffer } {
  const { header, aadLength } = peekHeader(blob);
  const nonce = blob.subarray(aadLength, aadLength + NONCE_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const body = blob.subarray(aadLength + NONCE_BYTES, blob.length - TAG_BYTES);
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(blob.subarray(0, aadLength));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new SyncCryptoError('Wrong passphrase, or the sync data was modified');
  }
  if (header.kind !== expectKind) throw new SyncCryptoError('Unexpected sync file type');
  return { header, plaintext };
}

// ---------------------------------------------------------------------------
// key file (plaintext JSON at the remote: KDF params + the data key wrapped by the passphrase key)

export interface KeyFile {
  format: 'vela-sync';
  v: 1;
  kdf: KdfParams;
  /** Data key sealed with the passphrase-derived key (base64 blob, header carries kdf). */
  wrappedKey: string;
  /** A constant sealed with the data key: verifies a recovery key without the passphrase. */
  check: string;
}

const CHECK_PLAINTEXT = Buffer.from('vela-sync-key-check', 'utf8');

export async function createKeyFile(passphrase: string): Promise<{ keyFile: KeyFile; dataKey: Buffer }> {
  const kdf = newKdfParams();
  const dataKey = randomBytes(KEY_BYTES);
  const wrapKey = await deriveKey(passphrase, kdf);
  const keyFile: KeyFile = {
    format: 'vela-sync',
    v: 1,
    kdf,
    wrappedKey: seal(wrapKey, { v: FORMAT_VERSION, kind: 'key', device: '', kdf }, dataKey).toString('base64'),
    check: seal(dataKey, { v: FORMAT_VERSION, kind: 'check', device: '' }, CHECK_PLAINTEXT).toString('base64'),
  };
  return { keyFile, dataKey };
}

export function parseKeyFile(raw: Buffer): KeyFile {
  let parsed: Partial<KeyFile>;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as Partial<KeyFile>;
  } catch {
    throw new SyncCryptoError('The sync key file is corrupted');
  }
  if (parsed?.format !== 'vela-sync' || parsed.v !== 1 || !validKdf(parsed.kdf) || typeof parsed.wrappedKey !== 'string' || typeof parsed.check !== 'string') {
    throw new SyncCryptoError('The sync key file is corrupted or from a newer Tarnel');
  }
  return parsed as KeyFile;
}

/** True when `dataKey` is the key this key file was made for. */
export function verifyDataKey(keyFile: KeyFile, dataKey: Buffer): boolean {
  try {
    const { plaintext } = open(dataKey, Buffer.from(keyFile.check, 'base64'), 'check');
    return plaintext.length === CHECK_PLAINTEXT.length && timingSafeEqual(plaintext, CHECK_PLAINTEXT);
  } catch {
    return false;
  }
}

export async function unwrapWithPassphrase(keyFile: KeyFile, passphrase: string): Promise<Buffer> {
  const wrapKey = await deriveKey(passphrase, keyFile.kdf);
  let dataKey: Buffer;
  try {
    const opened = open(wrapKey, Buffer.from(keyFile.wrappedKey, 'base64'), 'key');
    if (JSON.stringify(opened.header.kdf) !== JSON.stringify(keyFile.kdf)) throw new SyncCryptoError('Key parameters mismatch');
    dataKey = opened.plaintext;
  } catch {
    throw new SyncCryptoError('Wrong passphrase');
  }
  if (dataKey.length !== KEY_BYTES || !verifyDataKey(keyFile, dataKey)) throw new SyncCryptoError('Wrong passphrase');
  return dataKey;
}

// ---------------------------------------------------------------------------
// recovery key: the raw data key, RFC 4648 base32, in dash-separated groups of four

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function formatRecoveryKey(dataKey: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of dataKey) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

/** Returns the data key for a well-formed recovery key, or null when the input is not one. */
export function parseRecoveryKey(input: string): Buffer | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '');
  if (clean.length !== Math.ceil((KEY_BYTES * 8) / 5) || !/^[A-Z2-7]+$/.test(clean)) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | B32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return bytes.length >= KEY_BYTES ? Buffer.from(bytes.slice(0, KEY_BYTES)) : null;
}
