import type { Span } from '@opentelemetry/api';
import type { AttributeValue, NormalizedRequest, XrayContext } from './types';
import type { CaptureConfig, RedactionConfig, ResolvedXrayConfig } from './config';

export type RequestState = {
  request: NormalizedRequest;
  config: ResolvedXrayConfig;
  span?: Span;
  context: XrayContext;
  attributes: Record<string, AttributeValue>;
  events: Array<{ name: string; attributes?: Record<string, AttributeValue> }>;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  error?: unknown;
  captureOverride?: Partial<CaptureConfig>;
  redactionOverride?: Partial<RedactionConfig>;
};

const contextMap = new WeakMap<XrayContext, RequestState>();
const objectMap = new WeakMap<object, RequestState>();

export function bindContext(ctx: XrayContext, state: RequestState): void {
  contextMap.set(ctx, state);
}

export function getContextState(ctx: XrayContext): RequestState | undefined {
  return contextMap.get(ctx);
}

export function bindObject(target: object, state: RequestState): void {
  objectMap.set(target, state);
}

export function getContextFromObject(target: unknown): XrayContext | undefined {
  const state = getStateFromObject(target);
  return state?.context;
}

export function getStateFromObject(target: unknown): RequestState | undefined {
  if (!target || typeof target !== 'object') {
    return undefined;
  }
  if (objectMap.has(target)) {
    return objectMap.get(target);
  }

  const fallback = findNestedTarget(target as Record<string, unknown>);
  if (fallback && objectMap.has(fallback)) {
    return objectMap.get(fallback);
  }
  return undefined;
}

function findNestedTarget(obj: Record<string, unknown>): object | null {
  if (obj.raw && typeof obj.raw === 'object') {
    return obj.raw as object;
  }
  if (obj.req && typeof obj.req === 'object') {
    const req = obj.req as Record<string, unknown>;
    if (req.raw && typeof req.raw === 'object') {
      return req.raw as object;
    }
    return req as object;
  }
  if (obj.request && typeof obj.request === 'object') {
    const request = obj.request as Record<string, unknown>;
    if (request.raw && typeof request.raw === 'object') {
      return request.raw as object;
    }
    return request as object;
  }
  return null;
}
