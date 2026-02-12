/**
 * Base48 encoding with a vowel-free alphabet to reduce the risk of generating
 * profanity-like substrings in time-ordered identifiers while staying compact.
 * Digits that are commonly read as vowels (0, 1, 3, 4) are excluded to avoid
 * leetspeak-style false positives. The alphabet is ordered by ASCII to preserve
 * lexicographic ordering of fixed-length encodings.
 */
const base48AlphabetLex = '256789BCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz';
const base48Zero = base48AlphabetLex.charAt(0);
const base48Regex = /^[256789BCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz]*$/;

const maxChunkBytes = 32;
const chunkToEncodedLength = new Map<number, number>();
const encodedLengthToChunk = new Map<number, number>();

for (let size = 1; size <= maxChunkBytes; size += 1) {
  const encodedLength = Math.ceil((size * 8) / Math.log2(48));
  chunkToEncodedLength.set(size, encodedLength);
  encodedLengthToChunk.set(encodedLength, size);
}

const maxEncodedChunk = chunkToEncodedLength.get(maxChunkBytes)!;

function encodeChunk(bytes: Uint8Array, size: number): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  let encoded = '';
  if (value === 0n) {
    encoded = base48Zero;
  } else {
    while (value > 0n) {
      const mod = value % 48n;
      encoded = base48AlphabetLex[Number(mod)] + encoded;
      value /= 48n;
    }
  }

  const targetLength = chunkToEncodedLength.get(size);
  if (!targetLength) {
    throw new Error(`base48: unsupported chunk size ${size}`);
  }
  return encoded.padStart(targetLength, base48Zero);
}

function decodeChunk(value: string, size: number): Uint8Array {
  let n = 0n;
  for (const char of value) {
    const index = base48AlphabetLex.indexOf(char);
    if (index === -1) {
      throw new Error('base48: invalid character');
    }
    n = n * 48n + BigInt(index);
  }

  const maxValue = 2n ** BigInt(size * 8) - 1n;
  if (n > maxValue) {
    throw new Error('base48: invalid length');
  }

  const buffer = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i -= 1) {
    buffer[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buffer;
}

export function encodeBase48Lex(buffer: Uint8Array): string {
  if (buffer.length === 0) {
    return '';
  }

  let result = '';
  for (let offset = 0; offset < buffer.length; ) {
    const remaining = buffer.length - offset;
    const size = remaining >= maxChunkBytes ? maxChunkBytes : remaining;
    result += encodeChunk(buffer.slice(offset, offset + size), size);
    offset += size;
  }
  return result;
}

export function decodeBase48Lex(value: string): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }
  if (!base48Regex.test(value)) {
    throw new Error('base48: invalid string');
  }

  let totalBytes = 0;
  for (let offset = 0; offset < value.length; ) {
    const remaining = value.length - offset;
    const chunkLength = remaining >= maxEncodedChunk ? maxEncodedChunk : remaining;
    const size = encodedLengthToChunk.get(chunkLength);
    if (!size) {
      throw new Error('base48: invalid length');
    }
    totalBytes += size;
    offset += chunkLength;
  }

  const result = new Uint8Array(totalBytes);
  let cursor = 0;
  for (let offset = 0; offset < value.length; ) {
    const remaining = value.length - offset;
    const chunkLength = remaining >= maxEncodedChunk ? maxEncodedChunk : remaining;
    const size = encodedLengthToChunk.get(chunkLength);
    if (!size) {
      throw new Error('base48: invalid length');
    }
    const chunk = decodeChunk(value.slice(offset, offset + chunkLength), size);
    result.set(chunk, cursor);
    cursor += size;
    offset += chunkLength;
  }
  return result;
}
