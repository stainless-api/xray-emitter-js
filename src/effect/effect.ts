import { Cause, Effect, Exit, Option } from 'effect';
import { Headers, HttpApp, HttpRouter, HttpServerRequest } from '@effect/platform';
import type {
  CaptureConfig,
  NormalizedRequest,
  RedactionConfig,
  RequestLog,
  XrayContext,
  XrayEmitter,
  XrayRuntimeConfig,
} from '../core/index';
import { createEmitter as createFetchEmitter } from '../fetch/fetch';
import {
  bindContextToObject,
  getXrayContextFromObject,
  logWithLevel,
  makeCapturedBody,
  setCaptureOverride,
  setContextRequestId,
  setContextRoute,
  setRedactionOverride,
} from '../core/internal';

export { createEmitter as createCoreEmitter } from '../fetch/fetch';
export type {
  CaptureConfig,
  RedactionConfig,
  RequestLog,
  XrayConfig,
  XrayContext,
  XrayEmitter,
  XrayRuntimeConfig,
} from '../core/index';

export interface WrapOptions {
  route?: string;
  requestId?: string;
  capture?: Partial<CaptureConfig>;
  redaction?: Partial<RedactionConfig>;
  onRequest?: (ctx: XrayContext) => void;
  onResponse?: (ctx: XrayContext, log: RequestLog) => void;
  onError?: (ctx: XrayContext, err: unknown) => void;
}

type EffectMiddleware = <E, R>(httpApp: HttpApp.Default<E, R>) => HttpApp.Default<E, R>;

type EffectEmitter = EffectMiddleware & {
  flush: XrayEmitter['flush'];
  shutdown: XrayEmitter['shutdown'];
};

export function createEmitter(config: XrayRuntimeConfig, options?: WrapOptions): EffectEmitter {
  const emitter = createFetchEmitter(config);
  const middleware = createEffectMiddleware(emitter, options) as EffectEmitter;
  middleware.flush = emitter.flush;
  middleware.shutdown = emitter.shutdown;
  return middleware;
}

export function createEffectMiddleware(xray: XrayEmitter, options?: WrapOptions): EffectMiddleware {
  return (<E, R>(httpApp: HttpApp.Default<E, R>): HttpApp.Default<E, R> =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;

      const headers = effectHeadersToRecord(request.headers);
      const url = buildFullUrl(request.originalUrl, headers);

      // Try to read the route pattern from HttpRouter.RouteContext (available
      // when the middleware is applied via HttpRouter.use).
      const routeCtxOption = yield* Effect.serviceOption(HttpRouter.RouteContext);
      const route = Option.isSome(routeCtxOption)
        ? String(routeCtxOption.value.route.path)
        : options?.route;

      // Capture request body if configured.
      const captureReqBody = xray.config.capture.requestBody;
      let requestBody: NormalizedRequest['body'];
      if (captureReqBody && captureReqBody !== 'none') {
        const textResult = yield* Effect.either(request.text);
        if (textResult._tag === 'Right') {
          const bytes = new TextEncoder().encode(textResult.right);
          const maxBytes = xray.config.capture.maxBodyBytes;
          const truncated = bytes.length > maxBytes;
          const slice = truncated ? bytes.slice(0, maxBytes) : bytes;
          requestBody = makeCapturedBody(slice, bytes.length, truncated, captureReqBody);
        }
      }

      const normalizedRequest: NormalizedRequest = {
        method: request.method,
        url,
        route,
        headers,
        body: requestBody,
        requestId: options?.requestId,
        remoteAddress:
          request.remoteAddress._tag === 'Some' ? request.remoteAddress.value : undefined,
        startTimeMs: Date.now(),
      };

      const ctx = xray.startRequest(normalizedRequest);
      bindContextToObject(request, ctx);

      if (options?.requestId) {
        setContextRequestId(ctx, options.requestId);
      }
      if (route) {
        setContextRoute(ctx, route);
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

      const exit = yield* Effect.exit(httpApp);

      if (Exit.isSuccess(exit)) {
        const response = exit.value;
        const responseHeaders = effectHeadersToRecord(response.headers);

        const log = xray.endRequest(ctx, {
          statusCode: response.status,
          headers: responseHeaders,
          body: captureResponseBody(xray, response),
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
              { error: err instanceof Error ? err.message : String(err) },
            );
          }
        }

        return response;
      }

      const error = Cause.squash(exit.cause);
      const log = xray.endRequest(
        ctx,
        {
          statusCode: undefined,
          headers: undefined,
          body: undefined,
          endTimeMs: Date.now(),
        },
        error,
      );

      if (options?.onError) {
        try {
          options.onError(ctx, error);
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
            { error: errInner instanceof Error ? errInner.message : String(errInner) },
          );
        }
      }

      return yield* Effect.failCause(exit.cause);
    })) as EffectMiddleware;
}

/**
 * Retrieve the XrayContext bound to a request object.
 */
export function getXrayContext(
  request: HttpServerRequest.HttpServerRequest,
): XrayContext | undefined {
  return getXrayContextFromObject(request);
}

/**
 * Effect that retrieves the XrayContext from the current HttpServerRequest in scope.
 */
export const currentXrayContext: Effect.Effect<
  XrayContext | undefined,
  never,
  HttpServerRequest.HttpServerRequest
> = Effect.map(HttpServerRequest.HttpServerRequest, (request) => getXrayContextFromObject(request));

function effectHeadersToRecord(headers: Headers.Headers): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

function buildFullUrl(url: string, headers: Record<string, string | string[]>): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const host = headers['host'];
  if (!host || typeof host !== 'string') {
    return url;
  }
  return `http://${host}${url}`;
}

function captureResponseBody(
  xray: XrayEmitter,
  response: { body: { _tag: string; body?: unknown; contentLength?: number } },
): ReturnType<typeof makeCapturedBody> {
  const mode = xray.config.capture.responseBody;
  if (!mode || mode === 'none') return undefined;

  const body = response.body;
  if (body._tag === 'Uint8Array' && body.body instanceof Uint8Array) {
    const maxBytes = xray.config.capture.maxBodyBytes;
    const truncated = body.body.length > maxBytes;
    const slice = truncated ? body.body.slice(0, maxBytes) : body.body;
    return makeCapturedBody(slice, body.body.length, truncated, mode);
  }
  return undefined;
}
