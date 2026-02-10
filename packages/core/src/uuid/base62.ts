const base62AlphabetLex = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const base62Zero = base62AlphabetLex.charAt(0);
const base62Regex = /^[0-9A-Za-z]*$/;

const maxChunkBytes = 32;
const chunkToEncodedLength = new Map<number, number>();
const encodedLengthToChunk = new Map<number, number>();

for (let size = 1; size <= maxChunkBytes; size += 1) {
  const encodedLength = Math.ceil((size * 8) / Math.log2(62));
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
    encoded = base62Zero;
  } else {
    while (value > 0n) {
      const mod = value % 62n;
      encoded = base62AlphabetLex[Number(mod)] + encoded;
      value /= 62n;
    }
  }

  const targetLength = chunkToEncodedLength.get(size);
  if (!targetLength) {
    throw new Error(`base62: unsupported chunk size ${size}`);
  }
  return encoded.padStart(targetLength, base62Zero);
}

function decodeChunk(value: string, size: number): Uint8Array {
  let n = 0n;
  for (const char of value) {
    const index = base62AlphabetLex.indexOf(char);
    if (index === -1) {
      throw new Error('base62: invalid character');
    }
    n = n * 62n + BigInt(index);
  }

  const maxValue = 2n ** BigInt(size * 8) - 1n;
  if (n > maxValue) {
    throw new Error('base62: invalid length');
  }

  const buffer = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i -= 1) {
    buffer[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buffer;
}

export function encodeBase62Lex(buffer: Uint8Array): string {
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

export function decodeBase62Lex(value: string): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }
  if (!base62Regex.test(value)) {
    throw new Error('base62: invalid string');
  }

  let totalBytes = 0;
  for (let offset = 0; offset < value.length; ) {
    const remaining = value.length - offset;
    const chunkLength = remaining >= maxEncodedChunk ? maxEncodedChunk : remaining;
    const size = encodedLengthToChunk.get(chunkLength);
    if (!size) {
      throw new Error('base62: invalid length');
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
      throw new Error('base62: invalid length');
    }
    const chunk = decodeChunk(value.slice(offset, offset + chunkLength), size);
    result.set(chunk, cursor);
    cursor += size;
    offset += chunkLength;
  }
  return result;
}
