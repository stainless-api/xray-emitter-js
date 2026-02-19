import type { IncomingMessage, ServerResponse } from 'node:http';
import type { XrayEmitter, XrayContext, XrayRuntimeConfig } from '../core/index';
import {
  createEmitter as createNodeEmitter,
  wrapHttpHandler,
  type WrapOptions,
} from '../node/node';

export { createNodeEmitter as createCoreEmitter };
export type {
  CaptureConfig,
  RedactionConfig,
  RequestLog,
  XrayConfig,
  XrayContext,
  XrayEmitter,
  XrayRuntimeConfig,
} from '../core/index';
export type { WrapOptions } from '../node/node';

type NextFunction = (err?: unknown) => void;

// copy types from Express to avoid a package dependency
type ExpressMiddleware = (req: IncomingMessage, res: ServerResponse, next: NextFunction) => void;

type ExpressEmitter = ExpressMiddleware & {
  flush: XrayEmitter['flush'];
  shutdown: XrayEmitter['shutdown'];
};

/**
 * Create Express middleware that instruments requests and exposes
 * `flush()`/`shutdown()` on the returned middleware function.
 */
export function createEmitter(config: XrayRuntimeConfig, options?: WrapOptions): ExpressEmitter {
  const emitter = createNodeEmitter(config);
  const middleware = createExpressMiddleware(emitter, options) as ExpressEmitter;
  middleware.flush = emitter.flush;
  middleware.shutdown = emitter.shutdown;
  return middleware;
}

/**
 * Create Express middleware from an existing core `XrayEmitter`.
 */
export function createExpressMiddleware(
  xray: XrayEmitter,
  options?: WrapOptions,
): ExpressMiddleware {
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
          (
            (res as typeof res & { locals: Record<string, unknown> }).locals as {
              xray?: XrayContext;
            }
          ).xray = ctx;
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
