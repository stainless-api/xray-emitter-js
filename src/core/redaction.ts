import type { CapturedBody, RequestLog } from './types';
import { authSchemePrefix, redactCookieValue, redactSetCookieValue } from './header_redaction';

export function applyRedaction(
  config: {
    headers: string[];
    queryParams: string[];
    bodyJsonPaths: string[];
    replacement: string;
  },
  log: RequestLog,
): RequestLog {
  const redacted = { ...log };

  if (redacted.requestHeaders) {
    redacted.requestHeaders = redactHeaders(redacted.requestHeaders, config);
  }
  if (redacted.responseHeaders) {
    redacted.responseHeaders = redactHeaders(redacted.responseHeaders, config);
  }

  redacted.url = redactUrl(redacted.url, config);

  if (redacted.requestBody) {
    redacted.requestBody = redactBody(redacted.requestBody, redacted.requestHeaders, config);
  }
  if (redacted.responseBody) {
    redacted.responseBody = redactBody(redacted.responseBody, redacted.responseHeaders, config);
  }

  return redacted;
}

export function redactHeaders(
  headers: Record<string, string | string[]>,
  config: { headers: string[]; replacement: string },
): Record<string, string | string[]> {
  const list = new Set(config.headers.map((name) => name.toLowerCase()));
  const result: Record<string, string | string[]> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!list.has(lower)) {
      result[name] = value;
      continue;
    }

    const redactValue = (entry: string) => redactHeaderValue(lower, entry, config.replacement);
    if (Array.isArray(value)) {
      result[name] = value.map(redactValue);
    } else {
      result[name] = redactValue(value);
    }
  }

  return result;
}

function redactHeaderValue(name: string, value: string, replacement: string): string {
  switch (name) {
    case 'authorization':
    case 'proxy-authorization': {
      const scheme = authSchemePrefix(value);
      if (!scheme) {
        return replacement;
      }
      return `${scheme} ${replacement}`;
    }
    case 'cookie':
      return redactCookieValue(value, replacement);
    case 'set-cookie':
      return redactSetCookieValue(value, replacement);
    default:
      return replacement;
  }
}

function redactUrl(value: string, config: { queryParams: string[]; replacement: string }): string {
  if (!value || config.queryParams.length === 0) {
    return value;
  }

  try {
    const parsed = new URL(value);
    const params = parsed.searchParams;
    if (!params || params.size === 0) {
      return value;
    }

    const redact = new Set(config.queryParams.map((key) => key.toLowerCase()));
    const next = new URLSearchParams();
    params.forEach((val, key) => {
      if (redact.has(key.toLowerCase())) {
        next.append(key, config.replacement);
      } else {
        next.append(key, val);
      }
    });
    parsed.search = next.toString();
    return parsed.toString();
  } catch {
    return value;
  }
}

function redactBody(
  body: CapturedBody,
  headers: Record<string, string | string[]> | undefined,
  config: { bodyJsonPaths: string[]; replacement: string },
): CapturedBody {
  if (config.bodyJsonPaths.length === 0) {
    return body;
  }
  if (!body.value || body.encoding !== 'utf8') {
    return body;
  }
  if (!isJsonContentType(headers)) {
    return body;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.value);
  } catch {
    return body;
  }

  for (const path of config.bodyJsonPaths) {
    const segments = parseJsonPath(path);
    if (!segments) {
      continue;
    }
    redactJsonPath(parsed, segments, config.replacement);
  }

  const next = { ...body };
  next.value = JSON.stringify(parsed);
  return next;
}

function isJsonContentType(headers?: Record<string, string | string[]>): boolean {
  if (!headers) {
    return false;
  }
  const contentType = headers['content-type'] || headers['Content-Type'];
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  if (!value) {
    return false;
  }
  const normalized = value.split(';')[0];
  if (!normalized) {
    return false;
  }
  const trimmed = normalized.trim().toLowerCase();
  return trimmed === 'application/json' || trimmed.endsWith('+json');
}

type JsonPathSegment = string | number;

function parseJsonPath(path: string): JsonPathSegment[] | null {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed;
  if (!normalized) {
    return null;
  }

  const segments: JsonPathSegment[] = [];
  const parts = normalized.split('.');
  for (const part of parts) {
    if (!part) {
      continue;
    }
    let cursor = part;
    const bracketIndex = cursor.indexOf('[');
    if (bracketIndex === -1) {
      segments.push(cursor);
      continue;
    }

    const name = cursor.slice(0, bracketIndex);
    if (name) {
      segments.push(name);
    }
    cursor = cursor.slice(bracketIndex);
    const matches = cursor.match(/\[(\d+)\]/g);
    if (!matches) {
      continue;
    }
    for (const match of matches) {
      const indexValue = match.slice(1, -1);
      const index = Number.parseInt(indexValue, 10);
      if (Number.isFinite(index)) {
        segments.push(index);
      }
    }
  }

  return segments.length > 0 ? segments : null;
}

function redactJsonPath(value: unknown, segments: JsonPathSegment[], replacement: string): void {
  if (!value || segments.length === 0) {
    return;
  }

  let current: unknown = value;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === undefined) {
      return;
    }
    const isLast = i === segments.length - 1;

    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        return;
      }
      if (isLast) {
        current[segment] = replacement;
        return;
      }
      current = current[segment];
      continue;
    }

    if (!current || typeof current !== 'object') {
      return;
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) {
      return;
    }
    if (isLast) {
      record[segment] = replacement;
      return;
    }
    current = record[segment];
  }
}
