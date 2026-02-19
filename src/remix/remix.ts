import type { XrayEmitter, XrayRuntimeConfig } from '../core/index';
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
export { getXrayContext };

// copy type from react-router to avoid a package dependency
type RequestHandler = (request: Request, loadContext?: unknown) => Response | Promise<Response>;

type RemixEmitter = ((handler: RequestHandler) => RequestHandler) & {
  flush: XrayEmitter['flush'];
  shutdown: XrayEmitter['shutdown'];
};

/**
 * Create a Remix/React Router request-handler wrapper and expose
 * `flush()`/`shutdown()`.
 */
export function createEmitter(config: XrayRuntimeConfig, options?: WrapOptions): RemixEmitter {
  const emitter = createFetchEmitter(config);
  const wrap = ((handler: RequestHandler) =>
    wrapRemixRequestHandler(handler, emitter, options)) as RemixEmitter;
  wrap.flush = emitter.flush;
  wrap.shutdown = emitter.shutdown;
  return wrap;
}

/**
 * Wrap a Remix request handler using an existing core `XrayEmitter`.
 */
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
