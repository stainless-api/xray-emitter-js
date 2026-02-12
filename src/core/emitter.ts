import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { XrayConfig, ResolvedXrayConfig, CaptureConfig, RedactionConfig } from './config';
import { XrayConfigError, normalizeConfig } from './config';
import { logWithLevel } from './logger';
import { applyRedaction, redactHeaders } from './redaction';
import { makeCapturedBody, sanitizeHeaderValues, sanitizeLogString } from './request_log';
import {
  setHeaderAttributes,
  setRequestAttributes,
  setRequestBodyAttributes,
  setRequestBodySizeAttribute,
  setRequestIdAttribute,
  setResponseBodyAttributes,
  setResponseBodySizeAttribute,
  setResponseStatusAttribute,
  setRouteAttribute,
  setUserIdAttribute,
} from './attributes';
import {
  createTracerProvider,
  spanFromTracer,
  spanStatusFromError,
  tracerFromProvider,
} from './otel';
import { normalizeRoutePattern } from './route';
import { generateRequestId } from './uuid';
import { bindContext, getContextState, type RequestState } from './state';
import type {
  AttributeValue,
  NormalizedRequest,
  NormalizedResponse,
  RequestLog,
  XrayContext,
  XrayEmitter,
} from './types';

export function createEmitter(config: XrayConfig, exporter: SpanExporter): XrayEmitter {
  const resolved = normalizeConfig(config);
  if (!exporter) {
    throw new XrayConfigError(
      'INVALID_CONFIG',
      'exporter is required (use @stainlessdev/xray-node or @stainlessdev/xray-fetch)',
    );
  }
  logWithLevel(resolved.logger, 'info', resolved.logLevel, 'xray: emitter configured', {
    serviceName: resolved.serviceName,
    environment: resolved.environment,
    version: resolved.version,
    exporterEndpoint: resolved.exporter.endpointUrl,
    spanProcessor: resolved.exporter.spanProcessor,
  });
  const tracerProvider = createTracerProvider(resolved, exporter);
  const tracer = tracerFromProvider(tracerProvider);

  let shutdownCalled = false;

  const emitter: XrayEmitter = {
    config: resolved,
    startRequest: (req) => startRequest(resolved, tracer, req),
    endRequest: (ctx, res, err) => endRequest(resolved, ctx, res, err),
    flush: () => tracerProvider.forceFlush(),
    shutdown: () => {
      shutdownCalled = true;
      return tracerProvider.shutdown();
    },
  };

  // Auto-flush pending traces when the Node.js event loop drains.  This covers
  // script-style programs that exit without calling shutdown() explicitly.
  // Server programs keep the event loop alive so this only fires after the
  // server is already closed.
  if (typeof process !== 'undefined' && typeof process.once === 'function') {
    process.once('beforeExit', () => {
      if (!shutdownCalled) {
        shutdownCalled = true;
        void tracerProvider.shutdown();
      }
    });
  }

  return emitter;
}

function startRequest(
  config: ResolvedXrayConfig,
  tracer: ReturnType<typeof tracerFromProvider>,
  req: NormalizedRequest,
): XrayContext {
  const startTimeMs = Number.isFinite(req.startTimeMs) ? req.startTimeMs : Date.now();
  req.startTimeMs = startTimeMs;

  const explicitRequestId = normalizeRequestIdCandidate(req.requestId);
  req.requestId = explicitRequestId;

  if (req.route && config.route.normalize) {
    req.route = config.route.normalizer
      ? config.route.normalizer(req.route)
      : normalizeRoutePattern(req.route);
  }

  const span = spanFromTracer(tracer, spanNameFromRequest(req));
  const context: XrayContext = {
    requestId: explicitRequestId ?? '',
    traceId: span?.spanContext().traceId,
    spanId: span?.spanContext().spanId,
    setUserId: (id) => {
      const state = getContextState(context);
      if (!state) {
        return;
      }
      state.userId = id;
      if (span && id) {
        try {
          setUserIdAttribute(span, id);
        } catch {
          // Ignore span attribute errors.
        }
      }
    },
    setSessionId: (id) => {
      const state = getContextState(context);
      if (!state) {
        return;
      }
      state.sessionId = id;
    },
    setAttribute: (key, value) => {
      const state = getContextState(context);
      if (!state) {
        return;
      }
      state.attributes[key] = value;
      if (span) {
        try {
          span.setAttribute(key, value as AttributeValue);
        } catch {
          // Ignore span attribute errors.
        }
      }
    },
    addEvent: (name, attributes) => {
      const state = getContextState(context);
      if (!state) {
        return;
      }
      state.events.push({ name, attributes });
      if (span) {
        try {
          span.addEvent(name, attributes as Record<string, AttributeValue> | undefined);
        } catch {
          // Ignore span event errors.
        }
      }
    },
    setError: (err) => {
      const state = getContextState(context);
      if (!state) {
        return;
      }
      state.error = err;
      if (span) {
        try {
          spanStatusFromError(span, err);
        } catch {
          // Ignore span errors.
        }
      }
    },
  };

  const state: RequestState = {
    request: req,
    config,
    span,
    context,
    attributes: {},
    events: [],
  };

  bindContext(context, state);
  return context;
}

function endRequest(
  config: ResolvedXrayConfig,
  ctx: XrayContext,
  res: NormalizedResponse,
  err?: unknown,
): RequestLog {
  const state = getContextState(ctx);
  const endTimeMs = Number.isFinite(res.endTimeMs) ? res.endTimeMs : Date.now();
  res.endTimeMs = endTimeMs;

  if (!state) {
    const resolvedRequestId = resolveFinalRequestId(config, ctx.requestId, res.headers);
    ctx.requestId = resolvedRequestId;
    const fallbackLog: RequestLog = {
      requestId: resolvedRequestId,
      serviceName: config.serviceName,
      method: res.statusCode ? 'UNKNOWN' : 'UNKNOWN',
      url: '',
      durationMs: 0,
      statusCode: res.statusCode,
      timestamp: new Date(endTimeMs).toISOString(),
    };
    return fallbackLog;
  }

  const request = state.request;
  const resolvedRequestId = resolveFinalRequestId(
    config,
    request.requestId || ctx.requestId,
    res.headers,
  );
  request.requestId = resolvedRequestId;
  ctx.requestId = resolvedRequestId;
  const capture = resolveCapture(config.capture, state.captureOverride);
  const redaction = resolveRedaction(config.redaction, state.redactionOverride);

  const route = request.route;
  const url = sanitizeLogString(request.url);
  const log: RequestLog = {
    requestId: resolvedRequestId,
    traceId: state.span?.spanContext().traceId,
    spanId: state.span?.spanContext().spanId,
    serviceName: config.serviceName,
    method: request.method,
    url: url,
    route: route,
    statusCode: res.statusCode,
    durationMs: Math.max(0, endTimeMs - request.startTimeMs),
    requestHeaders: capture.requestHeaders ? sanitizeHeaderValues(request.headers) : undefined,
    responseHeaders: capture.responseHeaders ? sanitizeHeaderValues(res.headers) : undefined,
    requestBody: capture.requestBody === 'none' ? undefined : request.body,
    responseBody: capture.responseBody === 'none' ? undefined : res.body,
    userId: state.userId ?? undefined,
    sessionId: state.sessionId ?? undefined,
    error: buildError(err ?? state.error),
    attributes: Object.keys(state.attributes).length > 0 ? { ...state.attributes } : undefined,
    timestamp: new Date(endTimeMs).toISOString(),
  };

  const redacted = applyRedaction(redaction, log);
  if (redacted.route && config.route.normalize) {
    const normalized = config.route.normalizer
      ? config.route.normalizer(redacted.route)
      : normalizeRoutePattern(redacted.route);
    redacted.route = normalized;
  }
  const span = state.span;
  if (span) {
    try {
      const clientAddressHeaders = redactHeaders(request.headers, redaction);
      setRequestAttributes(
        span,
        {
          ...request,
          headers: clientAddressHeaders,
          redactionReplacement: redaction.replacement,
        },
        redacted.url,
      );
      setRequestIdAttribute(span, redacted.requestId);
      span.setAttribute('service.name', config.serviceName);
      if (redacted.statusCode != null) {
        setResponseStatusAttribute(span, redacted.statusCode);
      }
      if (redacted.route) {
        setRouteAttribute(span, redacted.route);
        span.updateName(`${request.method} ${redacted.route}`);
      } else {
        span.updateName(spanNameFromRequest(request));
      }
      if (redacted.requestHeaders) {
        setHeaderAttributes(span, redacted.requestHeaders, 'http.request.header.');
      }
      if (redacted.responseHeaders) {
        setHeaderAttributes(span, redacted.responseHeaders, 'http.response.header.');
      }
      if (redacted.requestBody) {
        setRequestBodyAttributes(span, redacted.requestBody);
        setRequestBodySizeAttribute(span, redacted.requestBody.bytes);
      }
      if (redacted.responseBody) {
        setResponseBodyAttributes(span, redacted.responseBody);
        setResponseBodySizeAttribute(span, redacted.responseBody.bytes);
      }
      if (state.userId) {
        setUserIdAttribute(span, state.userId);
      }
      if (err ?? state.error) {
        spanStatusFromError(span, err ?? state.error);
      }
      span.end();
    } catch (spanErr) {
      logWithLevel(config.logger, 'warn', config.logLevel, 'xray: span finalize failed', {
        error: spanErr instanceof Error ? spanErr.message : String(spanErr),
      });
    }
  }

  return redacted;
}

function resolveFinalRequestId(
  config: ResolvedXrayConfig,
  explicitRequestId: string | undefined,
  responseHeaders?: Record<string, string | string[]>,
): string {
  const explicit = normalizeRequestIdCandidate(explicitRequestId);
  if (explicit) {
    return explicit;
  }
  const headerValue = resolveHeaderRequestId(config.requestId.header, responseHeaders);
  if (headerValue) {
    return headerValue;
  }
  return generateRequestId();
}

function resolveHeaderRequestId(
  headerName: string,
  headers?: Record<string, string | string[]>,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const target = headerName.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== target) {
      continue;
    }
    const entry = Array.isArray(value) ? value[0] : value;
    const normalized = normalizeRequestIdCandidate(entry);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function normalizeRequestIdCandidate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function resolveCapture(base: CaptureConfig, override?: Partial<CaptureConfig>): CaptureConfig {
  if (!override) {
    return base;
  }
  return {
    ...base,
    ...override,
  };
}

function resolveRedaction(
  base: RedactionConfig,
  override?: Partial<RedactionConfig>,
): RedactionConfig {
  const merged: RedactionConfig = {
    ...base,
    ...override,
  };

  merged.headers = normalizeLowercaseList(merged.headers);
  merged.queryParams = normalizeLowercaseList(merged.queryParams);
  merged.bodyJsonPaths = normalizeList(merged.bodyJsonPaths);
  merged.replacement = merged.replacement || base.replacement;

  return merged;
}

function normalizeLowercaseList(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  return values.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function normalizeList(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  return values.map((entry) => entry.trim()).filter(Boolean);
}

function buildError(err?: unknown): RequestLog['error'] {
  if (!err) {
    return undefined;
  }
  if (err instanceof Error) {
    return {
      message: err.message || 'Error',
      type: err.name || 'Error',
      stack: err.stack,
    };
  }
  return {
    message: String(err),
  };
}

function spanNameFromRequest(req: NormalizedRequest): string {
  const method = req.method || 'GET';
  if (req.route) {
    return `${method} ${req.route}`;
  }
  const path = safePath(req.url);
  return `${method} ${path}`;
}

function safePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    const rawPath = url.split('?')[0] || '/';
    return rawPath || '/';
  }
}

export function captureBody(
  bytes: Uint8Array | undefined,
  totalBytes: number,
  truncated: boolean,
  mode: 'text' | 'base64' | 'none',
): ReturnType<typeof makeCapturedBody> {
  if (mode === 'none') {
    return undefined;
  }
  return makeCapturedBody(bytes, totalBytes, truncated, mode === 'text' ? 'text' : 'base64');
}

export function captureResponseBody(
  bytes: Uint8Array | undefined,
  totalBytes: number,
  truncated: boolean,
  mode: 'text' | 'base64' | 'none',
): ReturnType<typeof makeCapturedBody> {
  if (mode === 'none') {
    return undefined;
  }
  return makeCapturedBody(bytes, totalBytes, truncated, mode === 'text' ? 'text' : 'base64');
}
