import type {
  CaptureConfig,
  NormalizedRequest,
  RedactionConfig,
  RequestLog,
  XrayContext,
  XrayEmitter,
} from '../core/index';
import {
  LimitedBuffer,
  bindContextToObject,
  getXrayContextFromObject,
  headerValuesFromFetchHeaders,
  isWebsocketUpgradeFetch,
  logWithLevel,
  makeCapturedBody,
  setCaptureOverride,
  setContextRequestId,
  setContextRoute,
  setRedactionOverride,
  generateRequestId,
} from '../core/internal';

export interface WrapOptions {
  route?: string;
  requestId?: string;
  capture?: Partial<CaptureConfig>;
  redaction?: Partial<RedactionConfig>;
  onRequest?: (ctx: XrayContext) => void;
  onResponse?: (ctx: XrayContext, log: RequestLog) => void;
  onError?: (ctx: XrayContext, err: unknown) => void;
}

export function wrapFetch(
  handler: (req: Request) => Response | Promise<Response>,
  xray: XrayEmitter,
  options?: WrapOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const normalizedRequest: NormalizedRequest = {
      method: req.method,
      url: req.url,
      route: options?.route,
      headers: headerValuesFromFetchHeaders(req.headers),
      requestId: options?.requestId,
      startTimeMs: Date.now(),
    };

    const ctx = xray.startRequest(normalizedRequest);
    bindContextToObject(req, ctx);

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
    const requestForHandler = requestCapture?.request ?? req;
    if (requestForHandler !== req) {
      bindContextToObject(requestForHandler, ctx);
    }

    let response: Response;
    try {
      response = await handler(requestForHandler);
    } catch (err) {
      const log = xray.endRequest(
        ctx,
        {
          statusCode: undefined,
          headers: undefined,
          body: undefined,
          endTimeMs: Date.now(),
        },
        err,
      );
      if (options?.onError) {
        try {
          options.onError(ctx, err);
        } catch (errInner) {
          logWithLevel(xray.config.logger, 'warn', xray.config.logLevel, 'xray: onError failed', {
            error: errInner instanceof Error ? errInner.message : String(errInner),
          });
        }
      }
      if (options?.onResponse) {
        try {
          options.onResponse(ctx, log);
        } catch (errInner) {
          logWithLevel(
            xray.config.logger,
            'warn',
            xray.config.logLevel,
            'xray: onResponse failed',
            {
              error: errInner instanceof Error ? errInner.message : String(errInner),
            },
          );
        }
      }
      throw err;
    }

    if (!(response instanceof Response)) {
      const log = xray.endRequest(ctx, {
        statusCode: undefined,
        headers: undefined,
        body: undefined,
        endTimeMs: Date.now(),
      });
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
      return response;
    }

    const responseHeaders = new Headers(response.headers);
    ensureResponseRequestIdHeaders(responseHeaders, ctx, xray);
    const statusCode = response.status;
    const isUpgrade = isWebsocketUpgradeFetch(statusCode, req.headers, responseHeaders);

    if (!response.body || isUpgrade || capture.responseBody === 'none') {
      const log = finalizeResponse(
        ctx,
        xray,
        normalizedRequest,
        capture,
        requestCapture?.capture ?? null,
        responseHeaders,
        statusCode,
        null,
      );
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
      return new Response(response.body, {
        headers: responseHeaders,
        status: response.status,
        statusText: response.statusText,
      });
    }

    const responseCapture = new LimitedBuffer(capture.maxBodyBytes);
    let finished = false;
    const finalize = () => {
      if (finished) {
        return;
      }
      finished = true;
      const log = finalizeResponse(
        ctx,
        xray,
        normalizedRequest,
        capture,
        requestCapture?.capture ?? null,
        responseHeaders,
        statusCode,
        responseCapture,
      );
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

    const wrappedBody = wrapReadableStream(response.body, responseCapture, finalize, () => {
      finalize();
    });

    return new Response(wrappedBody, {
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

export function wrapFetchPreserve(
  handler: (req: Request) => Response | Promise<Response>,
  xray: XrayEmitter,
  options?: WrapOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const normalizedRequest: NormalizedRequest = {
      method: req.method,
      url: req.url,
      route: options?.route,
      headers: headerValuesFromFetchHeaders(req.headers),
      requestId: options?.requestId,
      startTimeMs: Date.now(),
    };

    const ctx = xray.startRequest(normalizedRequest);
    bindContextToObject(req, ctx);

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
    const requestCapturePromise =
      capture.requestBody === 'none'
        ? Promise.resolve(null)
        : captureRequestClone(req, capture.maxBodyBytes, xray);

    let response: Response;
    try {
      response = await handler(req);
    } catch (err) {
      const log = xray.endRequest(
        ctx,
        {
          statusCode: undefined,
          headers: undefined,
          body: undefined,
          endTimeMs: Date.now(),
        },
        err,
      );
      if (options?.onError) {
        try {
          options.onError(ctx, err);
        } catch (errInner) {
          logWithLevel(xray.config.logger, 'warn', xray.config.logLevel, 'xray: onError failed', {
            error: errInner instanceof Error ? errInner.message : String(errInner),
          });
        }
      }
      if (options?.onResponse) {
        try {
          options.onResponse(ctx, log);
        } catch (errInner) {
          logWithLevel(
            xray.config.logger,
            'warn',
            xray.config.logLevel,
            'xray: onResponse failed',
            {
              error: errInner instanceof Error ? errInner.message : String(errInner),
            },
          );
        }
      }
      throw err;
    }

    if (!(response instanceof Response)) {
      const log = xray.endRequest(ctx, {
        statusCode: undefined,
        headers: undefined,
        body: undefined,
        endTimeMs: Date.now(),
      });
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
      return response;
    }

    const responseHeaders = new Headers(response.headers);
    const ensured = ensureResponseRequestIdHeaders(responseHeaders, ctx, xray);
    if (ensured.set) {
      const headerName = canonicalHeaderName(xray.config.requestId.header);
      try {
        response.headers.set(headerName, ensured.value ?? '');
      } catch {
        response = new Response(response.body, {
          headers: responseHeaders,
          status: response.status,
          statusText: response.statusText,
        });
      }
    }
    const statusCode = response.status;
    const isUpgrade = isWebsocketUpgradeFetch(statusCode, req.headers, responseHeaders);
    const responseCapturePromise =
      !response.body || isUpgrade || capture.responseBody === 'none'
        ? Promise.resolve(null)
        : captureResponseClone(response, capture.maxBodyBytes, xray);

    void (async () => {
      const [requestCapture, responseCapture] = await Promise.all([
        requestCapturePromise,
        responseCapturePromise,
      ]);
      const log = finalizeResponse(
        ctx,
        xray,
        normalizedRequest,
        capture,
        requestCapture,
        responseHeaders,
        statusCode,
        responseCapture,
      );
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
    })().catch((err) => {
      logWithLevel(
        xray.config.logger,
        'warn',
        xray.config.logLevel,
        'xray: response capture failed',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    });

    return response;
  };
}

export function getXrayContext(req: Request): XrayContext | undefined {
  return getXrayContextFromObject(req);
}

type RequestCapture = {
  buffer: LimitedBuffer;
  read: boolean;
};

function wrapRequestBody(
  request: Request,
  limit: number,
): { capture: RequestCapture | null; request: Request } {
  if (limit <= 0 || !request.body || request.bodyUsed) {
    return { capture: null, request };
  }

  const originalBody = request.body;
  const capture: RequestCapture = {
    buffer: new LimitedBuffer(limit),
    read: false,
  };

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let started = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const wrappedStream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    async cancel(reason) {
      if (!started) {
        return;
      }
      try {
        await reader?.cancel(reason);
      } finally {
        // Ignore cancellation.
      }
    },
  });

  const startPump = () => {
    if (started) {
      return;
    }
    started = true;
    reader = originalBody.getReader();
    void (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller?.close();
            return;
          }
          if (value) {
            capture.read = true;
            capture.buffer.write(value);
            controller?.enqueue(value);
          }
        }
      } catch (err) {
        controller?.error(err);
      }
    })();
  };

  const originalGetReader = wrappedStream.getReader.bind(wrappedStream);
  (wrappedStream as unknown as { getReader: typeof wrappedStream.getReader }).getReader = (
    ...args: unknown[]
  ) => {
    startPump();
    // @ts-expect-error - preserve built-in `getReader` overloads
    return originalGetReader(...args);
  };

  const init: RequestInit & { duplex?: 'half' } = {
    body: wrappedStream,
    cache: request.cache,
    credentials: request.credentials,
    headers: request.headers,
    integrity: request.integrity,
    keepalive: request.keepalive,
    method: request.method,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  };
  if (isNodeRuntime()) {
    init.duplex = 'half';
  }

  const wrappedRequest = new Request(request.url, init);
  return { capture, request: wrappedRequest };
}

async function captureRequestClone(
  request: Request,
  limit: number,
  xray: XrayEmitter,
): Promise<LimitedBuffer | null> {
  if (limit <= 0 || !request.body || request.bodyUsed) {
    return null;
  }
  let clone: Request;
  try {
    clone = request.clone();
  } catch {
    logWithLevel(xray.config.logger, 'warn', xray.config.logLevel, 'xray: request clone failed');
    return null;
  }

  const buffer = new LimitedBuffer(limit);
  await readStreamToBuffer(clone.body, buffer);
  return buffer;
}

async function captureResponseClone(
  response: Response,
  limit: number,
  xray: XrayEmitter,
): Promise<LimitedBuffer | null> {
  if (limit <= 0 || !response.body || response.bodyUsed) {
    return null;
  }
  let clone: Response;
  try {
    clone = response.clone();
  } catch {
    logWithLevel(xray.config.logger, 'warn', xray.config.logLevel, 'xray: response clone failed');
    return null;
  }

  const buffer = new LimitedBuffer(limit);
  await readStreamToBuffer(clone.body, buffer);
  return buffer;
}

async function readStreamToBuffer(
  stream: ReadableStream<Uint8Array> | null,
  buffer: LimitedBuffer,
): Promise<void> {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      if (value) {
        buffer.write(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore release failures; reader may already be closed.
    }
  }
}

function wrapReadableStream(
  stream: ReadableStream<Uint8Array>,
  capture: LimitedBuffer,
  onFinish: () => void,
  onError?: (err: unknown) => void,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          onFinish();
          try {
            reader.releaseLock();
          } catch {
            // Ignore release failures; reader may already be closed.
          }
          return;
        }
        if (value) {
          capture.write(value);
          controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
        onError?.(err);
        onFinish();
        try {
          reader.releaseLock();
        } catch {
          // Ignore release failures; reader may already be closed.
        }
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        onFinish();
        try {
          reader.releaseLock();
        } catch {
          // Ignore release failures; reader may already be closed.
        }
      }
    },
  });
}

function finalizeResponse(
  ctx: XrayContext,
  xray: XrayEmitter,
  normalizedRequest: NormalizedRequest,
  capture: CaptureConfig,
  requestCapture: RequestCapture | LimitedBuffer | null,
  responseHeaders: Headers,
  statusCode: number,
  responseCapture: LimitedBuffer | null,
): RequestLog {
  if (requestCapture) {
    const buffer = requestCapture instanceof LimitedBuffer ? requestCapture : requestCapture.buffer;
    const read = requestCapture instanceof LimitedBuffer ? true : requestCapture.read;
    if (read) {
      normalizedRequest.body = makeCapturedBody(
        buffer.bytes(),
        buffer.totalBytes(),
        buffer.truncated(),
        capture.requestBody === 'text' ? 'text' : 'base64',
      );
    }
  }

  const responseBody = responseCapture
    ? makeCapturedBody(
        responseCapture.bytes(),
        responseCapture.totalBytes(),
        responseCapture.truncated(),
        capture.responseBody === 'text' ? 'text' : 'base64',
      )
    : undefined;

  return xray.endRequest(ctx, {
    statusCode,
    headers: headerValuesFromFetchHeaders(responseHeaders),
    body: responseBody,
    endTimeMs: Date.now(),
  });
}

function ensureResponseRequestIdHeaders(
  headers: Headers,
  ctx: XrayContext,
  xray: XrayEmitter,
): { value?: string; set: boolean } {
  const headerName = xray.config.requestId.header;
  const existing = normalizeRequestIdCandidate(headers.get(headerName) ?? undefined);
  if (existing) {
    return { value: existing, set: false };
  }

  const explicit = normalizeRequestIdCandidate(ctx.requestId);
  if (explicit) {
    headers.set(canonicalHeaderName(headerName), explicit);
    return { value: explicit, set: true };
  }

  const generated = generateRequestId();
  headers.set(canonicalHeaderName(headerName), generated);
  setContextRequestId(ctx, generated);
  return { value: generated, set: true };
}

function isNodeRuntime(): boolean {
  const maybeProcess = (
    globalThis as typeof globalThis & {
      process?: { versions?: { node?: string } };
    }
  ).process;
  return !!maybeProcess?.versions?.node;
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
