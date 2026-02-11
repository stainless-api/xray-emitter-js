import type { CapturedBody } from './types';
import { decodeUtf8, encodeBase64, isValidUtf8 } from './encoding';

// eslint-disable-next-line no-control-regex
const controlChars = /[\x00-\x1F\x7F]/g;

export function sanitizeLogString(value: string): string {
  if (!value) {
    return value;
  }
  return value.replace(controlChars, '');
}

export function sanitizeHeaderValues(
  headers: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> | undefined {
  if (!headers) {
    return undefined;
  }

  const sanitized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = sanitizeLogString(key);
    if (Array.isArray(value)) {
      sanitized[name] = value.map((entry) => sanitizeLogString(entry));
    } else {
      sanitized[name] = sanitizeLogString(value);
    }
  }
  return sanitized;
}

export function makeCapturedBody(
  bytes: Uint8Array | undefined,
  totalBytes: number,
  truncated: boolean,
  mode: 'text' | 'base64',
): CapturedBody | undefined {
  if (!bytes) {
    return undefined;
  }

  if (mode === 'base64') {
    return {
      bytes: totalBytes,
      encoding: 'base64',
      truncated,
      value: encodeBase64(bytes),
    };
  }

  if (isValidUtf8(bytes)) {
    return {
      bytes: totalBytes,
      encoding: 'utf8',
      truncated,
      value: decodeUtf8(bytes),
    };
  }

  return {
    bytes: totalBytes,
    encoding: 'base64',
    truncated,
    value: encodeBase64(bytes),
  };
}
