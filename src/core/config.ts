import { encodeBase64 } from './encoding';
import { normalizeRoutePattern } from './route';
import type { Logger, LogLevel } from './types';

/**
 * Exporter settings used by the OTLP trace exporter.
 */
export interface ExporterConfig {
  /**
   * OTLP trace endpoint URL. `/v1/traces` is appended if missing.
   */
  endpointUrl: string;
  /**
   * Additional OTLP exporter headers (for example `Authorization`).
   */
  headers?: Record<string, string>;
  /**
   * Export timeout in milliseconds.
   */
  timeoutMs: number;
  /**
   * Span processor mode.
   *
   * Use `batch` (default) for lower overhead in long-lived services.
   * Use `simple` to export each span immediately (useful for tests and
   * short-lived runtimes).
   */
  spanProcessor: 'simple' | 'batch';
}

/**
 * Request/response capture settings.
 */
export interface CaptureConfig {
  /**
   * Include sanitized request headers in logs/spans.
   */
  requestHeaders: boolean;
  /**
   * Include sanitized response headers in logs/spans.
   */
  responseHeaders: boolean;
  /**
   * Request body capture mode.
   *
   * `none` disables capture, `text` records UTF-8 text, and `base64` preserves
   * binary payloads safely.
   */
  requestBody: 'none' | 'text' | 'base64';
  /**
   * Response body capture mode.
   *
   * `none` disables capture, `text` records UTF-8 text, and `base64` preserves
   * binary payloads safely.
   */
  responseBody: 'none' | 'text' | 'base64';
  /**
   * Maximum captured bytes per request/response body before truncation.
   */
  maxBodyBytes: number;
}

/**
 * Redaction settings for logs and captured payloads.
 */
export interface RedactionConfig {
  /**
   * Header names to redact (case-insensitive).
   */
  headers: string[];
  /**
   * Query parameter names to redact (case-insensitive).
   */
  queryParams: string[];
  /**
   * JSON paths to redact in captured JSON bodies.
   */
  bodyJsonPaths: string[];
  /**
   * Replacement value used for redacted data.
   */
  replacement: string;
}

/**
 * Request ID extraction and propagation settings.
 */
export interface RequestIdConfig {
  /**
   * Response header name to read request IDs from. This is normalized to
   * lowercase during configuration.
   */
  header: string;
}

/**
 * Route normalization settings.
 */
export interface RouteConfig {
  /**
   * When true, normalize route patterns before emitting logs.
   */
  normalize: boolean;
  /**
   * Optional custom normalizer. Defaults to X-ray's built-in normalizer.
   */
  normalizer?: (path: string) => string;
}

/**
 * Core emitter configuration.
 */
export interface XrayConfig {
  /**
   * Logical service name for all emitted request logs.
   */
  serviceName: string;
  /**
   * Optional deployment environment label.
   */
  environment?: string;
  /**
   * Optional service version label.
   */
  version?: string;
  /**
   * Logger for internal X-ray diagnostics.
   */
  logger?: Logger;
  /**
   * Minimum log level for internal diagnostics.
   */
  logLevel?: LogLevel;
  /**
   * OTLP endpoint URL. Falls back to `STAINLESS_XRAY_ENDPOINT_URL`.
   */
  endpointUrl?: string;
  /**
   * Exporter overrides.
   */
  exporter?: Partial<ExporterConfig>;
  /**
   * Capture overrides.
   */
  capture?: Partial<CaptureConfig>;
  /**
   * Redaction overrides.
   */
  redaction?: Partial<RedactionConfig>;
  /**
   * Request ID resolution settings. The header is read from response headers at
   * the end of the request.
   */
  requestId?: Partial<RequestIdConfig>;
  /**
   * Route normalization overrides.
   */
  route?: Partial<RouteConfig>;
}

/**
 * Runtime config accepted by framework/node/fetch entrypoints.
 */
export type XrayRuntimeConfig = Omit<XrayConfig, 'exporter'> & {
  exporter?: Partial<ExporterConfig> & {
    /**
     * Custom exporter instance. When provided, endpoint/header options are ignored.
     */
    instance?: import('@opentelemetry/sdk-trace-base').SpanExporter;
  };
};

/**
 * Fully-resolved configuration returned by `normalizeConfig`.
 */
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

/**
 * Normalize and validate user configuration.
 *
 * Applies defaults, validates required fields, and resolves environment
 * fallbacks such as `STAINLESS_XRAY_ENDPOINT_URL`.
 */
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
  const spanProcessor = resolveSpanProcessor(cfg?.spanProcessor);
  const exporter: ExporterConfig = {
    endpointUrl: parsed.endpointUrl,
    headers: parsed.headers,
    timeoutMs: cfg?.timeoutMs ?? defaultExporterBase.timeoutMs,
    spanProcessor,
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

function resolveSpanProcessor(
  configured: ExporterConfig['spanProcessor'] | undefined,
): ExporterConfig['spanProcessor'] {
  if (configured) {
    return configured;
  }

  const envProcessor =
    typeof process !== 'undefined' ? process.env?.['STAINLESS_XRAY_SPAN_PROCESSOR'] : undefined;
  if (!envProcessor) {
    return defaultExporterBase.spanProcessor;
  }

  if (envProcessor === 'simple' || envProcessor === 'batch') {
    return envProcessor;
  }

  throw new XrayConfigError(
    'INVALID_CONFIG',
    'STAINLESS_XRAY_SPAN_PROCESSOR must be "simple" or "batch"',
  );
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
