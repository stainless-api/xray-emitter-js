import type { RequestHandler } from 'express';
import type { XrayEmitter, XrayContext, XrayRuntimeConfig } from '@stainlessdev/xray-core';
import {
  createEmitter as createNodeEmitter,
  wrapHttpHandler,
  type WrapOptions,
} from '@stainlessdev/xray-node';

export { createNodeEmitter as createCoreEmitter };
export type {
  CaptureConfig,
  RedactionConfig,
  RequestLog,
  XrayConfig,
  XrayContext,
  XrayEmitter,
  XrayRuntimeConfig,
} from '@stainlessdev/xray-core';
export type { WrapOptions } from '@stainlessdev/xray-node';

export type ExpressEmitter = RequestHandler & {
  flush: XrayEmitter['flush'];
  shutdown: XrayEmitter['shutdown'];
};

export function createEmitter(config: XrayRuntimeConfig, options?: WrapOptions): ExpressEmitter {
  const emitter = createNodeEmitter(config);
  const middleware = createExpressMiddleware(emitter, options) as ExpressEmitter;
  middleware.flush = emitter.flush;
  middleware.shutdown = emitter.shutdown;
  return middleware;
}

export function createExpressMiddleware(xray: XrayEmitter, options?: WrapOptions): RequestHandler {
  return (req, res, next) => {
    const wrapped = wrapHttpHandler(
      () => {
        next();
      },
      xray,
      {
        ...options,
        onRequest: (ctx: XrayContext) => {
          (req as typeof req & { xray?: XrayContext }).xray = ctx;
          (res as typeof res & { locals?: Record<string, unknown> }).locals ??= {};
          (res.locals as { xray?: XrayContext }).xray = ctx;
          options?.onRequest?.(ctx);
        },
      },
    );

    const result = wrapped(req, res);
    if (result && typeof (result as Promise<void>).catch === 'function') {
      void (result as Promise<void>).catch(next);
    }
  };
}
