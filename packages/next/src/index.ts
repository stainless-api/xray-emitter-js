import type { XrayEmitter, XrayRuntimeConfig } from '@stainlessdev/xray-core';
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
export { getXrayContext };

export type NextRouteContext = {
  params: Promise<Record<string, string | string[]>>;
};

export type NextRouteHandler = (
  request: Request,
  context: NextRouteContext,
) => Response | Promise<Response>;

export type NextEmitter = ((handler: NextRouteHandler) => ReturnType<typeof wrapNextRoute>) & {
  flush: XrayEmitter['flush'];
  shutdown: XrayEmitter['shutdown'];
};

export function createEmitter(config: XrayRuntimeConfig, options?: WrapOptions): NextEmitter {
  const emitter = createFetchEmitter(config);
  const wrap = ((handler: NextRouteHandler) =>
    wrapNextRoute(handler, emitter, options)) as NextEmitter;
  wrap.flush = emitter.flush;
  wrap.shutdown = emitter.shutdown;
  return wrap;
}

export function wrapNextRoute(
  handler: NextRouteHandler,
  xray: XrayEmitter,
  options?: WrapOptions,
): (request: Request, context: NextRouteContext) => Promise<Response> {
  return async (request, context) => {
    const wrapped = wrapFetchPreserve((req: Request) => handler(req, context), xray, options);
    return wrapped(request);
  };
}
