import type { RequestHandler } from 'react-router';
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

export type RemixEmitter = ((handler: RequestHandler) => RequestHandler) & {
  flush: XrayEmitter['flush'];
  shutdown: XrayEmitter['shutdown'];
};

export function createEmitter(config: XrayRuntimeConfig, options?: WrapOptions): RemixEmitter {
  const emitter = createFetchEmitter(config);
  const wrap = ((handler: RequestHandler) =>
    wrapRemixRequestHandler(handler, emitter, options)) as RemixEmitter;
  wrap.flush = emitter.flush;
  wrap.shutdown = emitter.shutdown;
  return wrap;
}

export function wrapRemixRequestHandler(
  handler: RequestHandler,
  xray: XrayEmitter,
  options?: WrapOptions,
): RequestHandler {
  return (request, loadContext) => {
    const wrapped = wrapFetchPreserve((req: Request) => handler(req, loadContext), xray, options);
    return wrapped(request);
  };
}
