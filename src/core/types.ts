/**
 * Attribute value types accepted by OpenTelemetry span attributes.
 */
export type AttributeValue = string | number | boolean | string[] | number[] | boolean[];

/**
 * Logging levels used by the internal X-ray logger.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger contract used by X-ray for internal diagnostics.
 */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Captured request/response body payload details.
 */
export interface CapturedBody {
  /**
   * Total body size before truncation.
   */
  bytes: number;
  /**
   * Encoding used for `value`.
   */
  encoding: 'utf8' | 'base64';
  /**
   * True when `value` was truncated due to `capture.maxBodyBytes`.
   */
  truncated: boolean;
  /**
   * Captured body payload. Omitted when there is no body.
   */
  value?: string;
}

/**
 * Final emitted request log record.
 */
export interface RequestLog {
  /**
   * Request identifier for this request.
   *
   * Written to span attributes and, where supported by the runtime/framework
   * adapter, propagated to response headers.
   */
  requestId: string;
  /**
   * OpenTelemetry trace ID for this request span.
   */
  traceId?: string;
  /**
   * OpenTelemetry span ID for this request span.
   */
  spanId?: string;
  /**
   * Service name from configuration.
   */
  serviceName: string;
  /**
   * HTTP method recorded at request start (for example `GET` or `POST`).
   */
  method: string;
  /**
   * Full URL after redaction.
   */
  url: string;
  /**
   * Normalized route pattern when available (for example `/users/{id}`).
   */
  route?: string;
  /**
   * Final HTTP response status code, when known.
   */
  statusCode?: number;
  /**
   * Request duration in milliseconds.
   */
  durationMs: number;
  /**
   * Sanitized and optionally redacted request headers.
   */
  requestHeaders?: Record<string, string | string[]>;
  /**
   * Sanitized and optionally redacted response headers.
   */
  responseHeaders?: Record<string, string | string[]>;
  /**
   * Captured request body when enabled by capture settings.
   */
  requestBody?: CapturedBody;
  /**
   * Captured response body when enabled by capture settings.
   */
  responseBody?: CapturedBody;
  /**
   * Tenant identifier recorded via `setActor`.
   */
  tenantId?: string;
  /**
   * User identifier recorded via `setActor` or legacy `setUserId`.
   */
  userId?: string;
  /**
   * Session identifier recorded via `setSessionId`.
   */
  sessionId?: string;
  /**
   * Captured error details when the request fails.
   */
  error?: { message: string; type?: string; stack?: string };
  /**
   * Custom attributes added via `setAttribute`.
   */
  attributes?: Record<string, AttributeValue>;
  /**
   * ISO timestamp for when request processing completed.
   */
  timestamp: string;
}

/**
 * Per-request context bound to framework request objects.
 */
export interface XrayContext {
  /**
   * Final request ID. May be empty until request completion.
   */
  requestId: string;
  /**
   * OpenTelemetry trace ID, when tracing is active.
   */
  traceId?: string;
  /**
   * OpenTelemetry span ID, when tracing is active.
   */
  spanId?: string;
  /**
   * Set actor identity for the request.
   *
   * `tenantId` is always recorded.
   * `userId` is recorded only when non-empty.
   */
  setActor(tenantId: string, userId: string): void;
  /**
   * @deprecated Use `setActor(tenantId, userId)` to record tenant and user IDs together.
   */
  setUserId(id: string): void;
  /**
   * Set a session identifier on the request log.
   */
  setSessionId(id: string): void;
  /**
   * Add or overwrite a custom attribute on the request span/log.
   */
  setAttribute(key: string, value: AttributeValue): void;
  /**
   * Add a span event for the current request.
   */
  addEvent(name: string, attributes?: Record<string, AttributeValue>): void;
  /**
   * Mark the request as failed with error details.
   */
  setError(err: unknown): void;
}

/**
 * Runtime-agnostic request input passed into `startRequest`.
 */
export interface NormalizedRequest {
  /**
   * HTTP method used for span naming and emitted log metadata.
   */
  method: string;
  /**
   * Full request URL before redaction.
   */
  url: string;
  /**
   * Route pattern (if known at request start).
   */
  route?: string;
  /**
   * Request headers as normalized string/string[] values.
   */
  headers: Record<string, string | string[]>;
  /**
   * Optional pre-captured body.
   */
  body?: CapturedBody;
  /**
   * Optional explicit request ID. If omitted, X-ray reads from response headers
   * when the span is closed (and generates a UUIDv7 if none is present).
   */
  requestId?: string;
  /**
   * Client remote address, used for client address attributes.
   */
  remoteAddress?: string;
  /**
   * Request start timestamp (milliseconds since epoch).
   */
  startTimeMs: number;
}

/**
 * Runtime-agnostic response input passed into `endRequest`.
 */
export interface NormalizedResponse {
  /**
   * HTTP response status code, if a response was produced.
   */
  statusCode?: number;
  /**
   * Response headers available at request completion.
   */
  headers?: Record<string, string | string[]>;
  /**
   * Optional captured response body.
   */
  body?: CapturedBody;
  /**
   * Response completion timestamp (milliseconds since epoch).
   */
  endTimeMs: number;
}

/**
 * Runtime-agnostic emitter API used by adapters/framework wrappers.
 */
export interface XrayEmitter {
  /**
   * Fully-resolved runtime configuration.
   */
  config: import('./config').ResolvedXrayConfig;
  /**
   * Start request tracking and return a mutable per-request context.
   */
  startRequest(req: NormalizedRequest): XrayContext;
  /**
   * Finish request tracking and return the emitted request log payload.
   */
  endRequest(ctx: XrayContext, res: NormalizedResponse, err?: unknown): RequestLog;
  /**
   * Flush pending spans to the configured exporter.
   */
  flush(): Promise<void>;
  /**
   * Shutdown the emitter and release exporter resources.
   */
  shutdown(): Promise<void>;
}
