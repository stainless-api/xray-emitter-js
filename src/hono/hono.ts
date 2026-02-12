import type { XrayEmitter, XrayContext, XrayRuntimeConfig } from '../core/index';
import { setContextRoute } from '../core/internal';
import {
  createEmitter as createFetchEmitter,
  getXrayContext,
  wrapFetchPreserve,
  type WrapOptions,
} from '../fetch/fetch';

export { createFetchEmitter as createCoreEmitter };
export type {
  CaptureConfig,
  RedactionConfig,
  RequestLog,
  XrayConfig,
  XrayContext,
  XrayEmitter,
  XrayRuntimeConfig,
} from '../core/index';
export type { WrapOptions } from '../fetch/fetch';

// copy types from Hono to avoid a package dependency
interface HonoCompatibleContext {
  req: { raw: Request };
  res: Response;
  set(key: string, value: unknown): void;
}

type HonoMiddleware = (
  c: HonoCompatibleContext,
  next: () => Promise<void>,
) => Promise<void | Response>;

export type HonoXrayEnv = {
  Variables: { xray?: XrayContext };
};

type HonoEmitter = HonoMiddleware & {
  flush: XrayEmitter['flush'];
  shutdown: XrayEmitter['shutdown'];
};

export interface HonoWrapOptions extends WrapOptions {
  routePath?(ctx: HonoCompatibleContext, index?: number): string;
}

export function createEmitter(config: XrayRuntimeConfig, options?: HonoWrapOptions): HonoEmitter {
  const emitter = createFetchEmitter(config);
  const middleware = createHonoMiddleware(emitter, options) as HonoEmitter;
  middleware.flush = emitter.flush;
  middleware.shutdown = emitter.shutdown;
  return middleware;
}

export function createHonoMiddleware(xray: XrayEmitter, options?: HonoWrapOptions): HonoMiddleware {
  const routePathFn = options?.routePath;

  return async (c, next) => {
    const request = c.req.raw;
    if (!request) {
      await next();
      return;
    }

    const wrapped = wrapFetchPreserve(
      async (req) => {
        const ctx = getXrayContext(req);
        if (ctx) {
          c.set('xray', ctx);
        }

        let route = resolveRoutePath(routePathFn, c, -1);
        try {
          await next();
          return c.res;
        } finally {
          if (!route) {
            route = resolveRoutePath(routePathFn, c);
          }
          if (route && ctx) {
            setContextRoute(ctx, route);
          }
        }
      },
      xray,
      options,
    );

    const response = await wrapped(request);
    if (response instanceof Response && response !== c.res) {
      c.res = response;
    }
  };
}

function resolveRoutePath(
  fn: ((ctx: HonoCompatibleContext, index?: number) => string) | undefined,
  ctx: HonoCompatibleContext,
  index?: number,
): string | undefined {
  if (!fn) {
    return undefined;
  }
  try {
    return index === undefined ? fn(ctx) : fn(ctx, index);
  } catch {
    return undefined;
  }
}
