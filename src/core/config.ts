import { encodeBase64 } from './encoding';
import { normalizeRoutePattern } from './route';
import type { Logger, LogLevel } from './types';

export interface ExporterConfig {
  endpointUrl: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  spanProcessor: 'simple' | 'batch';
}

export interface CaptureConfig {
  requestHeaders: boolean;
  responseHeaders: boolean;
  requestBody: 'none' | 'text' | 'base64';
  responseBody: 'none' | 'text' | 'base64';
  maxBodyBytes: number;
}

export interface RedactionConfig {
  headers: string[];
  queryParams: string[];
  bodyJsonPaths: string[];
  replacement: string;
}

export interface RequestIdConfig {
  /**
   * Response header name to read request IDs from. This is normalized to
   * lowercase during configuration.
   */
  header: string;
}

export interface RouteConfig {
  normalize: boolean;
  normalizer?: (path: string) => string;
}

export interface XrayConfig {
  serviceName: string;
  environment?: string;
  version?: string;
  logger?: Logger;
  logLevel?: LogLevel;
  endpointUrl?: string;
  exporter?: Partial<ExporterConfig>;
  capture?: Partial<CaptureConfig>;
  redaction?: Partial<RedactionConfig>;
  /**
   * Request ID resolution settings. The header is read from response headers at
   * the end of the request.
   */
  requestId?: Partial<RequestIdConfig>;
  route?: Partial<RouteConfig>;
}

export type XrayRuntimeConfig = Omit<XrayConfig, 'exporter'> & {
  exporter?: Partial<ExporterConfig> & {
    instance?: import('@opentelemetry/sdk-trace-base').SpanExporter;
  };
};

export interface ResolvedXrayConfig {
  serviceName: string;
  environment?: string;
  version?: string;
  logger: Logger;
  logLevel: LogLevel;
  exporter: ExporterConfig;
  capture: CaptureConfig;
  redaction: RedactionConfig;
  requestId: RequestIdConfig;
  route: RouteConfig;
}

const defaultCapture: CaptureConfig = {
  requestHeaders: true,
  responseHeaders: true,
  requestBody: 'text',
  responseBody: 'text',
  maxBodyBytes: 65536,
};

const defaultRedaction: RedactionConfig = {
  headers: ['authorization', 'cookie', 'set-cookie', 'x-api-key'],
  queryParams: [],
  bodyJsonPaths: [],
  replacement: '[REDACTED]',
};

const defaultRequestId: RequestIdConfig = {
  header: 'request-id',
};

const defaultRoute: RouteConfig = {
  normalize: true,
  normalizer: normalizeRoutePattern,
};

const defaultExporterBase: Omit<ExporterConfig, 'endpointUrl'> = {
  headers: {},
  timeoutMs: 30000,
  spanProcessor: 'batch',
};

export class XrayConfigError extends Error {
  code: 'INVALID_CONFIG' | 'INVALID_REDACTION';

  constructor(code: XrayConfigError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function normalizeConfig(config: XrayConfig): ResolvedXrayConfig {
  if (!config || !config.serviceName || !config.serviceName.trim()) {
    throw new XrayConfigError('INVALID_CONFIG', 'serviceName is required');
  }

  const logger = config.logger ?? console;
  const logLevel = config.logLevel ?? 'warn';

  const capture = normalizeCapture(config.capture);
  const redaction = normalizeRedaction(config.redaction);
  const requestId = normalizeRequestId(config.requestId);
  const route = normalizeRoute(config.route);
  const exporter = normalizeExporter(config.endpointUrl, config.exporter);

  return {
    serviceName: config.serviceName.trim(),
    environment: config.environment?.trim() || undefined,
    version: config.version?.trim() || undefined,
    logger,
    logLevel,
    exporter,
    capture,
    redaction,
    requestId,
    route,
  };
}

function normalizeCapture(cfg?: Partial<CaptureConfig>): CaptureConfig {
  const capture: CaptureConfig = {
    ...defaultCapture,
    ...cfg,
  };

  if (!['none', 'text', 'base64'].includes(capture.requestBody)) {
    throw new XrayConfigError(
      'INVALID_CONFIG',
      'capture.requestBody must be none, text, or base64',
    );
  }
  if (!['none', 'text', 'base64'].includes(capture.responseBody)) {
    throw new XrayConfigError(
      'INVALID_CONFIG',
      'capture.responseBody must be none, text, or base64',
    );
  }
  if (!Number.isFinite(capture.maxBodyBytes) || capture.maxBodyBytes < 0) {
    throw new XrayConfigError('INVALID_CONFIG', 'capture.maxBodyBytes must be >= 0');
  }

  return capture;
}

function normalizeRedaction(cfg?: Partial<RedactionConfig>): RedactionConfig {
  const redaction: RedactionConfig = {
    ...defaultRedaction,
    ...cfg,
  };

  redaction.headers = normalizeStringList(redaction.headers);
  redaction.queryParams = normalizeStringList(redaction.queryParams);
  redaction.bodyJsonPaths = normalizeStringList(redaction.bodyJsonPaths);
  redaction.replacement = redaction.replacement || defaultRedaction.replacement;

  if (!redaction.replacement) {
    throw new XrayConfigError('INVALID_REDACTION', 'redaction.replacement must be non-empty');
  }

  return redaction;
}

function normalizeRequestId(cfg?: Partial<RequestIdConfig>): RequestIdConfig {
  const requestId: RequestIdConfig = {
    ...defaultRequestId,
    ...cfg,
  };

  requestId.header = requestId.header.trim().toLowerCase();
  if (!requestId.header) {
    throw new XrayConfigError('INVALID_CONFIG', 'requestId.header must be non-empty');
  }

  return requestId;
}

function normalizeRoute(cfg?: Partial<RouteConfig>): RouteConfig {
  const route: RouteConfig = {
    ...defaultRoute,
    ...cfg,
  };

  if (route.normalize && !route.normalizer) {
    route.normalizer = normalizeRoutePattern;
  }

  return route;
}

function normalizeExporter(
  endpointUrl: string | undefined,
  cfg?: Partial<ExporterConfig>,
): ExporterConfig {
  const resolvedEndpoint = normalizeExporterEndpoint(cfg?.endpointUrl ?? endpointUrl);
  const rawHeaders = cfg?.headers ?? defaultExporterBase.headers ?? {};
  const parsed = applyEndpointAuth(resolvedEndpoint, rawHeaders);
  const exporter: ExporterConfig = {
    endpointUrl: parsed.endpointUrl,
    headers: parsed.headers,
    timeoutMs: cfg?.timeoutMs ?? defaultExporterBase.timeoutMs,
    spanProcessor: cfg?.spanProcessor ?? defaultExporterBase.spanProcessor,
  };

  return exporter;
}

function normalizeExporterEndpoint(endpointUrl: string | undefined): string {
  const envUrl =
    typeof process !== 'undefined' ? process.env?.['STAINLESS_XRAY_ENDPOINT_URL'] : undefined;
  const resolved = endpointUrl ?? envUrl;
  if (!resolved || !resolved.trim()) {
    throw new XrayConfigError(
      'INVALID_CONFIG',
      'endpointUrl is required (set endpointUrl or STAINLESS_XRAY_ENDPOINT_URL)',
    );
  }
  const trimmed = resolved.trim();
  const withoutTrailingSlash = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  if (withoutTrailingSlash.endsWith('/v1/traces')) {
    return withoutTrailingSlash;
  }
  return `${withoutTrailingSlash}/v1/traces`;
}

function normalizeStringList(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  return values.map((entry) => entry.trim()).filter(Boolean);
}

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const maybeBuffer = (
  globalThis as typeof globalThis & {
    Buffer?: { from(data: string, encoding?: string): Uint8Array };
  }
).Buffer;

function applyEndpointAuth(
  endpointUrl: string,
  headers: Record<string, string> | undefined,
): { endpointUrl: string; headers: Record<string, string> } {
  const resolvedHeaders = headers ?? {};
  let url: URL;
  try {
    url = new URL(endpointUrl);
  } catch {
    return { endpointUrl, headers: resolvedHeaders };
  }

  const username = decodeUserInfo(url.username);
  const password = decodeUserInfo(url.password);
  if (!username && !password) {
    return { endpointUrl, headers: resolvedHeaders };
  }

  url.username = '';
  url.password = '';
  const sanitizedUrl = url.toString();

  if (hasAuthorizationHeader(resolvedHeaders)) {
    return { endpointUrl: sanitizedUrl, headers: resolvedHeaders };
  }

  const authorization = encodeBasicAuth(username, password);
  if (!authorization) {
    return { endpointUrl: sanitizedUrl, headers: resolvedHeaders };
  }

  return {
    endpointUrl: sanitizedUrl,
    headers: {
      ...resolvedHeaders,
      Authorization: authorization,
    },
  };
}

function decodeUserInfo(value: string): string {
  if (!value) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
}

function encodeBasicAuth(username: string, password: string): string | undefined {
  const raw = `${username}:${password}`;
  let bytes: Uint8Array | undefined;
  if (textEncoder) {
    bytes = textEncoder.encode(raw);
  } else if (maybeBuffer) {
    bytes = maybeBuffer.from(raw, 'utf8');
  }
  if (!bytes) {
    return undefined;
  }
  const encoded = encodeBase64(bytes);
  if (!encoded) {
    return undefined;
  }
  return `Basic ${encoded}`;
}
