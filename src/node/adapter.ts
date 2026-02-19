import type { IncomingMessage, ServerResponse } from 'node:http';
import { TLSSocket } from 'node:tls';
import type {
  CaptureConfig,
  NormalizedRequest,
  NormalizedResponse,
  RedactionConfig,
  RequestLog,
  XrayContext,
  XrayEmitter,
} from '../core/index';
import {
  LimitedBuffer,
  bindContextToObject,
  getXrayContextFromObject,
  headerValuesFromNodeHeaders,
  isWebsocketUpgrade,
  logWithLevel,
  makeCapturedBody,
  setCaptureOverride,
  setContextRequestId,
  setContextRoute,
  setRedactionOverride,
  generateRequestId,
} from '../core/internal';

/**
 * Handler signature for `node:http` request listeners.
 */
export type NodeHttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/**
 * Per-handler overrides for `wrapHttpHandler`.
 */
export interface WrapOptions {
  /**
   * Explicit route pattern for this handler (for example `/users/:id`).
   */
  route?: string;
  /**
   * Explicit request ID. Skips header lookup/generation when provided.
   */
  requestId?: string;
  /**
   * Per-handler capture overrides.
   */
  capture?: Partial<CaptureConfig>;
  /**
   * Per-handler redaction overrides.
   */
  redaction?: Partial<RedactionConfig>;
  /**
   * Hook called after request context is created.
   */
  onRequest?: (ctx: XrayContext) => void;
  /**
   * Hook called after the request has been finalized and logged.
   */
  onResponse?: (ctx: XrayContext, log: RequestLog) => void;
  /**
   * Hook called when request handling fails.
   */
  onError?: (ctx: XrayContext, err: unknown) => void;
}

/**
 * Wrap a `node:http` request handler with X-ray instrumentation.
 *
 * The wrapper binds `XrayContext` to both `req` and `res`, captures configured
 * request/response metadata, and ensures a response request ID header is set.
 */
export function wrapHttpHandler(
  handler: NodeHttpHandler,
  xray: XrayEmitter,
  options?: WrapOptions,
): NodeHttpHandler {
  return (req, res) => {
    const normalizedRequest: NormalizedRequest = {
      method: req.method ?? 'GET',
      url: fullUrl(req),
      route: options?.route,
      headers: headerValuesFromNodeHeaders(
        req.headers as Record<string, string | string[] | number | undefined>,
      ),
      requestId: options?.requestId,
      remoteAddress: req.socket?.remoteAddress,
      startTimeMs: Date.now(),
    };

    trackExpressParams(req);

    const ctx = xray.startRequest(normalizedRequest);
    bindContextToObject(req, ctx);
    bindContextToObject(res, ctx);

    if (options?.requestId) {
      setContextRequestId(ctx, options.requestId);
    }
    if (options?.route) {
      setContextRoute(ctx, options.route);
    }
    if (options?.capture) {
      setCaptureOverride(ctx, options.capture);
    }
    if (options?.redaction) {
      setRedactionOverride(ctx, options.redaction);
    }

    if (options?.onRequest) {
      try {
        options.onRequest(ctx);
      } catch (err) {
        logWithLevel(xray.config.logger, 'warn', xray.config.logLevel, 'xray: onRequest failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const capture = options?.capture
      ? { ...xray.config.capture, ...options.capture }
      : xray.config.capture;

    const requestCapture =
      capture.requestBody === 'none' ? null : wrapRequestBody(req, capture.maxBodyBytes);
    const recorder = new ResponseRecorder(
      capture.responseBody !== 'none',
      capture.maxBodyBytes,
      (response) => {
        ensureResponseRequestId(response, ctx, xray);
      },
    );
    recorder.wrap(res);

    let finished = false;
    let capturedError: unknown;
    let onErrorCalled = false;

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      if (!normalizedRequest.route) {
        const route = resolveExpressRoute(req);
        if (route) {
          normalizedRequest.route = route;
        }
      }

      if (requestCapture && requestCapture.read) {
        normalizedRequest.body = makeCapturedBody(
          requestCapture.buffer.bytes(),
          requestCapture.buffer.totalBytes(),
          requestCapture.buffer.truncated(),
          capture.requestBody === 'text' ? 'text' : 'base64',
        );
      }

      const responseHeaders = recorder.headersSnapshot(res.getHeaders());
      const recordedStatus = recorder.statusCode() ?? res.statusCode;
      const statusCode = capturedError && !recorder.hasWrittenHeader() ? 500 : recordedStatus;
      const isUpgrade = isWebsocketUpgrade(
        statusCode ?? 0,
        normalizedRequest.headers,
        responseHeaders,
      );

      const responseBody =
        recorder.bodyCaptured() && !isUpgrade
          ? makeCapturedBody(
              recorder.body(),
              recorder.totalBytes(),
              recorder.truncated(),
              capture.responseBody === 'text' ? 'text' : 'base64',
            )
          : undefined;

      const normalizedResponse: NormalizedResponse = {
        statusCode: statusCode ?? undefined,
        headers: responseHeaders,
        body: responseBody,
        endTimeMs: Date.now(),
      };

      const log = xray.endRequest(ctx, normalizedResponse, capturedError);

      if (capturedError && options?.onError && !onErrorCalled) {
        onErrorCalled = true;
        try {
          options.onError(ctx, capturedError);
        } catch (err) {
          logWithLevel(xray.config.logger, 'warn', xray.config.logLevel, 'xray: onError failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (options?.onResponse) {
        try {
          options.onResponse(ctx, log);
        } catch (err) {
          logWithLevel(
            xray.config.logger,
            'warn',
            xray.config.logLevel,
            'xray: onResponse failed',
            {
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }
    };

    res.once('finish', finish);
    res.once('close', finish);

    try {
      const result = handler(req, res);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch((err) => {
          capturedError = err;
          if (options?.onError && !onErrorCalled) {
            onErrorCalled = true;
            try {
              options.onError(ctx, err);
            } catch (errInner) {
              logWithLevel(
                xray.config.logger,
                'warn',
                xray.config.logLevel,
                'xray: onError failed',
                {
                  error: errInner instanceof Error ? errInner.message : String(errInner),
                },
              );
            }
          }
        });
      }
    } catch (err) {
      capturedError = err;
      if (options?.onError && !onErrorCalled) {
        onErrorCalled = true;
        try {
          options.onError(ctx, err);
        } catch (errInner) {
          logWithLevel(xray.config.logger, 'warn', xray.config.logLevel, 'xray: onError failed', {
            error: errInner instanceof Error ? errInner.message : String(errInner),
          });
        }
      }
      throw err;
    }
  };
}

/**
 * Retrieve the `XrayContext` bound to a Node `IncomingMessage`.
 */
export function getXrayContext(req: IncomingMessage): XrayContext | undefined {
  return getXrayContextFromObject(req);
}

type RequestCapture = {
  buffer: LimitedBuffer;
  read: boolean;
  userConsuming: boolean;
};

function wrapRequestBody(req: IncomingMessage, limit: number): RequestCapture | null {
  if (limit <= 0) {
    return null;
  }
  if (!hasRequestBody(req)) {
    return null;
  }

  const capture: RequestCapture = {
    buffer: new LimitedBuffer(limit),
    read: false,
    userConsuming: false,
  };

  const originalPush = req.push;
  req.push = function push(chunk: unknown, encoding?: BufferEncoding): boolean {
    if (chunk != null) {
      recordChunk(capture, chunk, encoding);
    }
    return originalPush.call(req, chunk as any, encoding as any);
  } as typeof req.push;

  const originalEmit = req.emit;
  req.emit = function emit(event: string, ...args: unknown[]): boolean {
    if (event === 'data' && capture.userConsuming && args[0] != null) {
      capture.read = true;
    }
    if (event === 'end' && capture.userConsuming) {
      capture.read = true;
    }
    return originalEmit.call(req, event, ...args);
  } as typeof req.emit;

  const originalOn = req.on;
  req.on = function on(event: string, listener: (...args: any[]) => void): any {
    if (event === 'data' || event === 'readable') {
      capture.userConsuming = true;
    }
    return originalOn.call(req, event, listener);
  } as typeof req.on;

  const originalOnce = req.once;
  req.once = function once(event: string, listener: (...args: any[]) => void): any {
    if (event === 'data' || event === 'readable') {
      capture.userConsuming = true;
    }
    return originalOnce.call(req, event, listener);
  } as typeof req.once;

  const originalAddListener = req.addListener;
  req.addListener = function addListener(event: string, listener: (...args: any[]) => void): any {
    if (event === 'data' || event === 'readable') {
      capture.userConsuming = true;
    }
    return originalAddListener.call(req, event, listener);
  } as typeof req.addListener;

  const originalPipe = req.pipe;
  req.pipe = function pipe(destination: unknown, options?: unknown): unknown {
    capture.userConsuming = true;
    return originalPipe.call(req, destination as any, options as any);
  } as typeof req.pipe;

  const originalRead = req.read;
  req.read = function read(size?: number): any {
    capture.userConsuming = true;
    const chunk = originalRead.call(req, size as any) as unknown;
    const readableFlowing = (req as IncomingMessage & { readableFlowing?: boolean | null })
      .readableFlowing;
    const hasDataListeners =
      typeof req.listenerCount === 'function' && req.listenerCount('data') > 0;
    if (!hasDataListeners && readableFlowing !== true && chunk != null) {
      capture.read = true;
    }
    return chunk as any;
  } as typeof req.read;

  return capture;
}

function hasRequestBody(req: IncomingMessage): boolean {
  if (req.headers['content-length'] != null) {
    return true;
  }
  if (req.headers['transfer-encoding'] != null) {
    return true;
  }
  return false;
}

function recordChunk(capture: RequestCapture, chunk: unknown, encoding?: BufferEncoding): void {
  const bytes = toBytes(chunk, encoding);
  if (!bytes) {
    return;
  }
  capture.buffer.write(bytes);
}

function toBytes(chunk: unknown, encoding?: BufferEncoding): Uint8Array | null {
  if (chunk == null) {
    return null;
  }
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, encoding);
  }
  if (chunk instanceof Uint8Array) {
    return chunk;
  }
  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }
  return null;
}

class ResponseRecorder {
  private readonly buffer: LimitedBuffer | null;
  private headerSnapshot?: Record<string, string | string[] | number | undefined>;
  private status?: number;
  private wroteHeader = false;
  private bytes = 0;
  private readonly onHeader?: (res: ServerResponse) => void;

  constructor(captureBody: boolean, maxBodySize: number, onHeader?: (res: ServerResponse) => void) {
    this.buffer = captureBody ? new LimitedBuffer(maxBodySize) : null;
    this.onHeader = onHeader;
  }

  body(): Uint8Array {
    return this.buffer?.bytes() ?? new Uint8Array();
  }

  totalBytes(): number {
    return this.buffer?.totalBytes() ?? 0;
  }

  bodyCaptured(): boolean {
    return !!this.buffer && this.buffer.totalBytes() > 0;
  }

  bytesWritten(): number {
    return this.bytes;
  }

  hasWrittenHeader(): boolean {
    return this.wroteHeader;
  }

  headersSnapshot(
    defaultHeaders: Record<string, string | string[] | number | undefined>,
  ): Record<string, string | string[]> {
    if (this.headerSnapshot) {
      return headerValuesFromNodeHeaders(this.headerSnapshot);
    }
    return headerValuesFromNodeHeaders(defaultHeaders);
  }

  statusCode(): number | undefined {
    return this.status;
  }

  truncated(): boolean {
    return this.buffer?.truncated() ?? false;
  }

  wrap(res: ServerResponse): void {
    const originalWriteHead = res.writeHead;
    res.writeHead = ((statusCode: number, ...args: any[]) => {
      if (!this.wroteHeader) {
        this.applyWriteHeadHeaders(res, args);
      }
      this.recordHeader(res, statusCode);
      return (originalWriteHead as any).call(res, statusCode, ...args);
    }) as typeof res.writeHead;

    const originalWrite = res.write;
    res.write = ((chunk: unknown, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => {
      this.recordHeader(res, res.statusCode ?? 200);
      this.recordWrite(chunk, encoding);
      return originalWrite.call(res, chunk as any, encoding as any, cb as any);
    }) as typeof res.write;

    const originalEnd = res.end;
    res.end = ((chunk?: unknown, encoding?: BufferEncoding, cb?: () => void) => {
      this.recordHeader(res, res.statusCode ?? 200);
      if (chunk) {
        this.recordWrite(chunk, encoding);
      }
      return originalEnd.call(res, chunk as any, encoding as any, cb as any);
    }) as typeof res.end;

    if (typeof res.flushHeaders === 'function') {
      const originalFlush = res.flushHeaders;
      res.flushHeaders = (() => {
        this.recordHeader(res, res.statusCode ?? 200);
        return originalFlush.call(res);
      }) as typeof res.flushHeaders;
    }
  }

  private recordHeader(res: ServerResponse, statusCode: number): void {
    if (this.wroteHeader) {
      return;
    }
    this.onHeader?.(res);
    this.wroteHeader = true;
    this.status = statusCode;
    this.headerSnapshot = { ...res.getHeaders() } as Record<
      string,
      string | string[] | number | undefined
    >;
  }

  private applyWriteHeadHeaders(res: ServerResponse, args: any[]): void {
    if (args.length === 0) {
      return;
    }
    const headersArg = typeof args[0] === 'string' ? args[1] : args[0];
    if (!headersArg) {
      return;
    }
    if (Array.isArray(headersArg)) {
      if (headersArg.length === 0) {
        return;
      }
      if (typeof headersArg[0] === 'string') {
        for (let i = 0; i < headersArg.length - 1; i += 2) {
          const name = headersArg[i];
          const value = headersArg[i + 1];
          if (typeof name === 'string' && value !== undefined && value !== null) {
            res.setHeader(name, value as any);
          }
        }
        return;
      }
      for (const entry of headersArg) {
        if (!Array.isArray(entry)) {
          continue;
        }
        const [name, value] = entry;
        if (typeof name === 'string' && value !== undefined && value !== null) {
          res.setHeader(name, value as any);
        }
      }
      return;
    }
    if (typeof headersArg === 'object') {
      for (const [name, value] of Object.entries(headersArg as Record<string, unknown>)) {
        if (value !== undefined && value !== null) {
          res.setHeader(name, value as any);
        }
      }
    }
  }

  private recordWrite(chunk: unknown, encoding?: BufferEncoding): void {
    const bytes = toBytes(chunk, encoding);
    if (!bytes) {
      return;
    }
    this.bytes += bytes.length;
    if (this.buffer) {
      this.buffer.write(bytes);
    }
  }
}

function ensureResponseRequestId(res: ServerResponse, ctx: XrayContext, xray: XrayEmitter): void {
  const headerName = xray.config.requestId.header;
  const existing = headerValueFromNode(res.getHeader(headerName));
  if (existing) {
    return;
  }

  const explicit = normalizeRequestIdCandidate(ctx.requestId);
  if (explicit) {
    res.setHeader(canonicalHeaderName(headerName), explicit);
    return;
  }

  const generated = generateRequestId();
  res.setHeader(canonicalHeaderName(headerName), generated);
  setContextRequestId(ctx, generated);
}

function fullUrl(req: IncomingMessage): string {
  const requestUrl = resolveRequestUrl(req);
  if (!requestUrl) {
    return '';
  }
  if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
    return requestUrl;
  }

  const host = req.headers['host'];
  if (!host || typeof host !== 'string') {
    return requestUrl;
  }
  const scheme = req.socket instanceof TLSSocket ? 'https' : 'http';
  return `${scheme}://${host}${requestUrl}`;
}

function resolveRequestUrl(req: IncomingMessage): string {
  const requestUrl = req.url ?? '';
  if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
    return requestUrl;
  }

  const expressReq = req as IncomingMessage & { originalUrl?: unknown };
  if (typeof expressReq.originalUrl === 'string' && expressReq.originalUrl.length > 0) {
    return expressReq.originalUrl;
  }
  return requestUrl;
}

function headerValueFromNode(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return normalizeRequestIdCandidate(value[0]);
  }
  return normalizeRequestIdCandidate(`${value}`);
}

function normalizeRequestIdCandidate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function canonicalHeaderName(headerName: string): string {
  return headerName
    .split('-')
    .filter(Boolean)
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join('-');
}

type ExpressRoutePath = string | string[] | RegExp;

type ExpressRouteParams = Record<string, string | string[]>;

const expressParamsHistory = new WeakMap<IncomingMessage, ExpressRouteParams[]>();

function trackExpressParams(req: IncomingMessage): void {
  if (expressParamsHistory.has(req)) {
    return;
  }
  const anyReq = req as IncomingMessage & { app?: unknown };
  if (typeof anyReq.app !== 'function') {
    return;
  }

  const history: ExpressRouteParams[] = [];
  expressParamsHistory.set(req, history);

  const descriptor = Object.getOwnPropertyDescriptor(req, 'params');
  if (descriptor && !descriptor.configurable) {
    if (descriptor.value && typeof descriptor.value === 'object') {
      history.push({ ...(descriptor.value as ExpressRouteParams) });
    }
    return;
  }

  let current = (
    descriptor && 'value' in descriptor
      ? (descriptor.value as ExpressRouteParams | undefined)
      : undefined
  ) as ExpressRouteParams | undefined;
  if (current && typeof current === 'object') {
    history.push({ ...current });
  }

  Object.defineProperty(req, 'params', {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get() {
      return current;
    },
    set(value) {
      current = value as ExpressRouteParams | undefined;
      if (value && typeof value === 'object') {
        history.push({ ...(value as ExpressRouteParams) });
      }
    },
  });
}

function resolveExpressRoute(req: IncomingMessage): string | undefined {
  const anyReq = req as IncomingMessage & {
    baseUrl?: string;
    params?: ExpressRouteParams;
    route?: { path?: ExpressRoutePath };
  };
  const routePath = extractExpressRoutePath(anyReq.route?.path);
  const baseUrl = anyReq.baseUrl ?? '';
  if (!routePath && !baseUrl) {
    return undefined;
  }

  const params = collectExpressParams(req, anyReq.params);
  const resolvedBaseUrl = replaceBaseUrlParams(baseUrl, params, routePath);
  return joinExpressRoute(resolvedBaseUrl, routePath);
}

function extractExpressRoutePath(path?: ExpressRoutePath): string | undefined {
  if (typeof path === 'string') {
    return path;
  }
  if (Array.isArray(path)) {
    for (const entry of path) {
      if (typeof entry === 'string') {
        return entry;
      }
    }
  }
  return undefined;
}

function collectExpressParams(
  req: IncomingMessage,
  fallback?: ExpressRouteParams,
): ExpressRouteParams {
  const history = expressParamsHistory.get(req);
  if (!history || history.length === 0) {
    return fallback ?? {};
  }

  const merged: ExpressRouteParams = {};
  for (const snapshot of history) {
    for (const [key, value] of Object.entries(snapshot)) {
      if (!(key in merged)) {
        merged[key] = value;
      }
    }
  }
  if (fallback) {
    for (const [key, value] of Object.entries(fallback)) {
      if (!(key in merged)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function replaceBaseUrlParams(
  baseUrl: string,
  params: ExpressRouteParams,
  routePath?: string,
): string {
  if (!baseUrl) {
    return baseUrl;
  }
  const entries = Object.entries(params);
  if (entries.length === 0) {
    return baseUrl;
  }

  const excluded = new Set(routePath ? extractExpressParamNames(routePath) : []);
  const replacements = entries
    .filter(([name]) => !excluded.has(name))
    .map(([name, value]) => ({ name, value: Array.isArray(value) ? value[0] : value }))
    .filter((entry): entry is { name: string; value: string } => !!entry.value);

  if (replacements.length === 0) {
    return baseUrl;
  }

  const used = new Set<string>();
  const encodedCache = new Map<string, string>();
  const segments = baseUrl.split('/');
  const updated = segments.map((segment) => {
    if (!segment) {
      return segment;
    }
    for (const { name, value } of replacements) {
      if (used.has(name)) {
        continue;
      }
      const encodedValue = encodedCache.get(value) ?? encodeURIComponent(value);
      encodedCache.set(value, encodedValue);
      if (segment === value || segment === encodedValue) {
        used.add(name);
        return `:${name}`;
      }
    }
    return segment;
  });

  return updated.join('/');
}

function extractExpressParamNames(path: string): string[] {
  const names: string[] = [];
  const paramPattern = /:([A-Za-z0-9_]+)(?:\([^)]*\))?[?*+]?/g;
  for (const match of path.matchAll(paramPattern)) {
    const name = match[1];
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function joinExpressRoute(baseUrl: string, routePath?: string): string {
  const base = baseUrl ? ensureLeadingSlash(baseUrl) : '';
  const route = routePath ? ensureLeadingSlash(routePath) : '';
  if (!base) {
    return route || '/';
  }
  if (!route || route === '/') {
    return base;
  }
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmedBase}${route}`;
}

function ensureLeadingSlash(path: string): string {
  if (!path) {
    return '/';
  }
  return path.startsWith('/') ? path : `/${path}`;
}
