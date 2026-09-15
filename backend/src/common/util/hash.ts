import { createHash } from 'node:crypto';

export const HASH_LENGTH_BYTES = 32;

/** 32 zero bytes — the previousHash of every audit chain's genesis row. */
export const GENESIS_HASH = Buffer.alloc(HASH_LENGTH_BYTES, 0);

export function sha256(...parts: Buffer[]): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/**
 * Prisma's generated types want a `Uint8Array<ArrayBuffer>` for Bytes
 * columns, which a plain `Buffer` (typed `Uint8Array<ArrayBufferLike>`)
 * doesn't structurally satisfy. `Uint8Array.from` copies into a fresh,
 * unambiguously `ArrayBuffer`-backed instance.
 */
export function toPrismaBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buffer.length);
  out.set(buffer);
  return out;
}
