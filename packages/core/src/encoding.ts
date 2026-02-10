const utf8Decoder =
  typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : null;
const utf8DecoderLenient = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
const maybeBuffer = (
  globalThis as typeof globalThis & {
    Buffer?: { from(data: Uint8Array): { toString(encoding?: string): string } };
  }
).Buffer;

export function encodeBase64(bytes: Uint8Array): string {
  if (maybeBuffer) {
    return maybeBuffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) {
      continue;
    }
    binary += String.fromCharCode(byte);
  }
  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }
  return '';
}

export function isValidUtf8(bytes: Uint8Array): boolean {
  if (!utf8Decoder) {
    return false;
  }
  try {
    utf8Decoder.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function decodeUtf8(bytes: Uint8Array): string {
  if (utf8DecoderLenient) {
    return utf8DecoderLenient.decode(bytes);
  }
  if (maybeBuffer) {
    return maybeBuffer.from(bytes).toString('utf8');
  }
  return '';
}
