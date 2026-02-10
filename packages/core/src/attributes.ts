import type { Span } from '@opentelemetry/api';
import {
  ATTR_CLIENT_ADDRESS,
  ATTR_HTTP_REQUEST_BODY_SIZE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_BODY_SIZE,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_USER_ID,
} from '@opentelemetry/semantic-conventions/incubating';
import type { CapturedBody } from './types';
import {
  AttributeKeyRequestBody,
  AttributeKeyRequestBodyEncoding,
  AttributeKeyRequestBodyTruncated,
  AttributeKeyRequestID,
  AttributeKeyResponseBody,
  AttributeKeyResponseBodyEncoding,
  AttributeKeyResponseBodyTruncated,
} from './attrkey';

export function setHeaderAttributes(
  span: Span,
  headers: Record<string, string | string[]> | undefined,
  prefix: string,
): void {
  if (!headers) {
    return;
  }
  const keys = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  for (const key of keys) {
    const values = headers[key];
    if (!values || (Array.isArray(values) && values.length === 0)) {
      continue;
    }
    span.setAttribute(prefix + key.toLowerCase(), Array.isArray(values) ? values : [values]);
  }
}

export function setRequestAttributes(
  span: Span,
  request: {
    method: string;
    url?: string;
    headers?: Record<string, string | string[]>;
    remoteAddress?: string;
    redactionReplacement?: string;
  },
  urlFull: string | undefined,
): void {
  span.setAttribute(ATTR_HTTP_REQUEST_METHOD, request.method);
  const effectiveUrl = urlFull ?? request.url;
  if (effectiveUrl) {
    span.setAttribute(ATTR_URL_FULL, effectiveUrl);
    const path = extractPath(effectiveUrl);
    if (path) {
      span.setAttribute(ATTR_URL_PATH, path);
    }
  }
  const clientAddress = clientAddressForRequest(
    request.headers,
    request.remoteAddress,
    request.redactionReplacement,
  );
  if (clientAddress) {
    span.setAttribute(ATTR_CLIENT_ADDRESS, clientAddress);
  }
}

function extractPath(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    // If not a full URL, try to extract path directly
    const match = url.match(/^[^?#]*/);
    return match?.[0] || undefined;
  }
}

function clientAddressForRequest(
  headers?: Record<string, string | string[]>,
  remoteAddress?: string,
  redactionReplacement?: string,
): string | undefined {
  const forwarded = forwardedClientAddress(
    headerValues(headers, 'forwarded'),
    redactionReplacement,
  );
  if (forwarded) {
    return forwarded;
  }
  const xForwarded = xForwardedForClientAddress(
    headerValues(headers, 'x-forwarded-for'),
    redactionReplacement,
  );
  if (xForwarded) {
    return xForwarded;
  }
  const xRealIp = xRealIpClientAddress(headerValues(headers, 'x-real-ip'), redactionReplacement);
  if (xRealIp) {
    return xRealIp;
  }
  if (!remoteAddress) {
    return undefined;
  }
  return remoteAddrHost(remoteAddress);
}

function forwardedClientAddress(
  values: string[],
  redactionReplacement?: string,
): string | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const entries = value.split(',');
    for (const entry of entries) {
      const params = entry.split(';');
      for (const param of params) {
        const [rawKey, ...rest] = param.split('=');
        if (!rawKey) {
          continue;
        }
        if (rawKey.trim().toLowerCase() !== 'for') {
          continue;
        }
        const rawValue = rest.join('=').trim();
        const normalized = normalizeKnownAddress(rawValue, redactionReplacement);
        if (normalized) {
          return normalized;
        }
      }
    }
  }
  return undefined;
}

function xForwardedForClientAddress(
  values: string[],
  redactionReplacement?: string,
): string | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const entries = value.split(',');
    for (const entry of entries) {
      const normalized = normalizeKnownAddress(entry, redactionReplacement);
      if (normalized) {
        return normalized;
      }
    }
  }
  return undefined;
}

function xRealIpClientAddress(values: string[], redactionReplacement?: string): string | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const normalized = normalizeKnownAddress(value, redactionReplacement);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function normalizeKnownAddress(value: string, redactionReplacement?: string): string | undefined {
  const normalized = normalizeAddress(value, redactionReplacement);
  if (!normalized) {
    return undefined;
  }
  if (normalized.toLowerCase() === 'unknown') {
    return undefined;
  }
  return normalized;
}

function normalizeAddress(value: string, redactionReplacement?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  let trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (redactionReplacement && trimmed === redactionReplacement) {
    return undefined;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end !== -1) {
      return trimmed.slice(1, end);
    }
  }
  // If there's exactly one colon, treat it as host:port. More than one likely means IPv6.
  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const host = trimmed.split(':')[0];
    return host || undefined;
  }
  return trimmed;
}

function remoteAddrHost(value: string): string | undefined {
  return normalizeAddress(value);
}

function headerValues(
  headers: Record<string, string | string[]> | undefined,
  name: string,
): string[] {
  if (!headers) {
    return [];
  }
  const target = name.toLowerCase();
  const values: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue;
    }
    if (Array.isArray(value)) {
      values.push(...value);
    } else {
      values.push(value);
    }
  }
  return values;
}

export function setRequestBodyAttributes(span: Span, body: CapturedBody): void {
  if (!body.value) {
    return;
  }
  span.setAttribute(AttributeKeyRequestBody, body.value);
  span.setAttribute(AttributeKeyRequestBodyEncoding, body.encoding);
  if (body.truncated) {
    span.setAttribute(AttributeKeyRequestBodyTruncated, true);
  }
}

export function setRequestBodySizeAttribute(span: Span, size: number): void {
  span.setAttribute(ATTR_HTTP_REQUEST_BODY_SIZE, size);
}

export function setResponseBodyAttributes(span: Span, body: CapturedBody): void {
  if (!body.value) {
    return;
  }
  span.setAttribute(AttributeKeyResponseBody, body.value);
  span.setAttribute(AttributeKeyResponseBodyEncoding, body.encoding);
  if (body.truncated) {
    span.setAttribute(AttributeKeyResponseBodyTruncated, true);
  }
}

export function setResponseBodySizeAttribute(span: Span, size: number): void {
  span.setAttribute(ATTR_HTTP_RESPONSE_BODY_SIZE, size);
}

export function setResponseStatusAttribute(span: Span, statusCode: number): void {
  span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, statusCode);
}

export function setRouteAttribute(span: Span, route: string | undefined): void {
  if (route) {
    span.setAttribute(ATTR_HTTP_ROUTE, route);
  }
}

export function setUserIdAttribute(span: Span, userId: string): void {
  span.setAttribute(ATTR_USER_ID, userId);
}

export function setRequestIdAttribute(span: Span, requestId: string): void {
  span.setAttribute(AttributeKeyRequestID, requestId);
}
