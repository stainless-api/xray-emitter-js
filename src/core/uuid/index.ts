import { encodeBase48Lex } from './base48';
import { encodeBase62Lex } from './base62';

const requestIdPrefix = 'req_';

function uuidv7Bytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Encode timestamp in first 48 bits
  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  // Set version (7) and variant (RFC 4122)
  const byte6 = bytes[6] ?? 0;
  const byte8 = bytes[8] ?? 0;
  bytes[6] = (byte6 & 0x0f) | 0x70;
  bytes[8] = (byte8 & 0x3f) | 0x80;

  return bytes;
}

/**
 * Generates a UUIDv7 string.
 * Uses crypto.getRandomValues which is available in all modern JS runtimes
 * (browsers, Node.js 15+, Deno, Bun, Cloudflare Workers, Vercel Edge, etc.)
 */
export function uuidv7(): string {
  const bytes = uuidv7Bytes();
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export function uuidv7base62(): string {
  return encodeBase62Lex(uuidv7Bytes());
}

export function uuidv7base48(): string {
  return encodeBase48Lex(uuidv7Bytes());
}

export function generateRequestId(): string {
  return `${requestIdPrefix}${uuidv7base48()}`;
}
