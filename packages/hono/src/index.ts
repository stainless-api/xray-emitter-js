import type { Env, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import type { XrayEmitter, XrayContext, XrayRuntimeConfig } from '@stainlessdev/xray-core';
import { setContextRoute } from '@stainlessdev/xray-core/internal';
import {
  createEmitter as createFetchEmitter,
  getXrayContext,
  wrapFetchPreserve,
  type WrapOptions,
} from '@stainlessdev/xray-fetch';

export { createFetchEmitter as createCoreEmitter };
export type {
  CaptureConfig,
  RedactionConfig,
  RequestLog,
  XrayConfig,
  XrayContext,
  XrayEmitter,
  XrayRuntimeConfig,
} from '@stainlessdev/xray-core';
export type { WrapOptions } from '@stainlessdev/xray-fetch';

export type HonoXrayEnv = {
  Variables: { xray?: XrayContext };
};

declare module 'hono' {
  interface ContextVariableMap {
    xray?: XrayContext;
  }
}

export type HonoEmitter<E extends Env = Env> = MiddlewareHandler<E & HonoXrayEnv> & {
  flush: XrayEmitter['flush'];
  shutdown: XrayEmitter['shutdown'];
};

export function createEmitter<E extends Env = Env>(
  config: XrayRuntimeConfig,
  options?: WrapOptions,
): HonoEmitter<E> {
  const emitter = createFetchEmitter(config);
  const middleware = createHonoMiddleware<E>(emitter, options) as HonoEmitter<E>;
  middleware.flush = emitter.flush;
  middleware.shutdown = emitter.shutdown;
  return middleware;
}

export function createHonoMiddleware<E extends Env = Env>(
  xray: XrayEmitter,
  options?: WrapOptions,
) {
  return createMiddleware<E & HonoXrayEnv>(async (c, next) => {
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

        let route = resolveRoutePath(c, -1);
        try {
          await next();
          return c.res;
        } finally {
          if (!route) {
            route = resolveRoutePath(c);
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
  });
}

function resolveRoutePath(ctx: unknown, index?: number): string | undefined {
  try {
    if (index === undefined) {
      return routePath(ctx as Parameters<typeof routePath>[0]);
    }
    return routePath(ctx as Parameters<typeof routePath>[0], index);
  } catch {
    return undefined;
  }
}
