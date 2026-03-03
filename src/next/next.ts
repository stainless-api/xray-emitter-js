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

// copy types from Next.js to avoid a package dependency
type NextRouteContext = {
  params: Promise<Record<string, string | string[]>>;
};

type NextRouteHandler = (
  request: Request,
  context: NextRouteContext,
) => Response | Promise<Response>;

type NextEmitter = ((handler: NextRouteHandler) => ReturnType<typeof wrapNextRoute>) & {
  flush: XrayEmitter['flush'];
  shutdown: XrayEmitter['shutdown'];
};

/**
 * Create a Next.js App Router wrapper and expose `flush()`/`shutdown()`.
 */
export function createEmitter(config: XrayRuntimeConfig, options?: WrapOptions): NextEmitter {
  const emitter = createFetchEmitter(config);
  const wrap = ((handler: NextRouteHandler) =>
    wrapNextRoute(handler, emitter, options)) as NextEmitter;
  wrap.flush = emitter.flush;
  wrap.shutdown = emitter.shutdown;
  return wrap;
}

/**
 * Wrap a Next.js route handler using an existing core `XrayEmitter`.
 */
export function wrapNextRoute(
  handler: NextRouteHandler,
  xray: XrayEmitter,
  options?: WrapOptions,
): (request: Request, context: NextRouteContext) => Promise<Response> {
  return async (request, context) => {
    // When no explicit route option was provided, infer the route pattern
    // from the URL pathname and the resolved params (e.g. { subject: "test" }
    // turns /hello/test into /hello/[subject]).
    let effectiveOptions = options;
    if (!options?.route) {
      const params = await context.params;
      const route = inferRoute(new URL(request.url).pathname, params);
      if (route) {
        effectiveOptions = { ...options, route };
      }
    }

    const wrapped = wrapFetchPreserve(
      (req: Request) => handler(req, context),
      xray,
      effectiveOptions,
    );
    return wrapped(request);
  };
}

function inferRoute(
  pathname: string,
  params: Record<string, string | string[]>,
): string | undefined {
  // Build a map from param value → placeholder for single-segment params.
  const replacements = new Map<string, string>();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      replacements.set(value, `[${key}]`);
    }
  }
  if (replacements.size === 0) return undefined;

  const segments = pathname.split('/');
  let replaced = false;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const placeholder = replacements.get(seg);
    if (placeholder) {
      // If this param value appears in more than one segment we cannot
      // tell which is the dynamic one — bail out entirely.
      if (segments.indexOf(seg, i + 1) !== -1) return undefined;
      segments[i] = placeholder;
      replacements.delete(seg);
      replaced = true;
    }
  }
  return replaced ? segments.join('/') : undefined;
}
