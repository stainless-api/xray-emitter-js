import type { XrayEmitter, XrayContext, XrayRuntimeConfig } from '@stainlessdev/xray-core';
import {
  createEmitter as createNodeEmitter,
  wrapHttpHandler,
  getXrayContext,
  type WrapOptions,
} from '@stainlessdev/xray-node';
import { setContextRoute } from '@stainlessdev/xray-core/internal';

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

export type FastifyInstance = {
  addHook: {
    (name: 'onRequest', hook: (...args: any[]) => unknown): void;
    (name: 'preHandler', hook: (...args: any[]) => unknown): void;
  };
};

export type FastifyEmitter = ((instance: FastifyInstance) => void) & {
  flush: XrayEmitter['flush'];
  shutdown: XrayEmitter['shutdown'];
};

export function createEmitter(config: XrayRuntimeConfig, options?: WrapOptions): FastifyEmitter {
  const emitter = createNodeEmitter(config);
  const register = ((instance: FastifyInstance) => {
    addFastifyHooks(instance, emitter, options);
  }) as FastifyEmitter;
  register.flush = emitter.flush;
  register.shutdown = emitter.shutdown;
  return register;
}

export function addFastifyHooks(
  instance: FastifyInstance,
  xray: XrayEmitter,
  options?: WrapOptions,
): void {
  const nodeHandler = wrapHttpHandler(() => {}, xray, {
    ...options,
    onRequest: (ctx: XrayContext) => {
      options?.onRequest?.(ctx);
    },
  });

  instance.addHook(
    'onRequest',
    (request: unknown, reply: unknown, next: (err?: unknown) => void) => {
      const req = request as { raw?: Parameters<typeof nodeHandler>[0]; xray?: XrayContext };
      const res = reply as { raw?: Parameters<typeof nodeHandler>[1] };
      if (!req.raw || !res.raw) {
        next();
        return;
      }
      nodeHandler(req.raw, res.raw);
      req.xray = getXrayContext(req.raw);
      next();
    },
  );

  instance.addHook(
    'preHandler',
    (request: unknown, _reply: unknown, next: (err?: unknown) => void) => {
      const anyReq = request as {
        routeOptions?: { url?: string };
        raw?: Parameters<typeof nodeHandler>[0];
      };
      const route = anyReq.routeOptions?.url;
      if (route && anyReq.raw) {
        const ctx = getXrayContext(anyReq.raw);
        if (ctx) {
          setContextRoute(ctx, route);
        }
      }
      next();
    },
  );
}
