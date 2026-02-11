import type { CaptureConfig, RedactionConfig } from './config';
import type { XrayContext } from './types';
import { bindObject, getContextFromObject, getContextState } from './state';

export { LimitedBuffer } from './limited_buffer';
export {
  headerValuesFromFetchHeaders,
  headerValuesFromFetchHeadersWithLimit,
  headerValuesFromNodeHeaders,
  headerTokenList,
} from './headers';
export { isWebsocketUpgrade, isWebsocketUpgradeFetch } from './websocket';
export { makeCapturedBody } from './request_log';
export { logWithLevel } from './logger';
export { generateRequestId, uuidv7, uuidv7base48, uuidv7base62 } from './uuid';

export function bindContextToObject(target: object, ctx: XrayContext): void {
  const state = getContextState(ctx);
  if (!state) {
    return;
  }
  bindObject(target, state);
}

export function getXrayContextFromObject(target: unknown): XrayContext | undefined {
  return getContextFromObject(target);
}

export function setContextRoute(ctx: XrayContext, route: string): void {
  const state = getContextState(ctx);
  if (!state) {
    return;
  }
  const normalized =
    state.config.route.normalize && state.config.route.normalizer
      ? state.config.route.normalizer(route)
      : route;
  state.request.route = normalized;
}

export function setContextRequestId(ctx: XrayContext, requestId: string): void {
  const state = getContextState(ctx);
  if (!state) {
    return;
  }
  state.request.requestId = requestId;
  state.context.requestId = requestId;
}

export function setCaptureOverride(
  ctx: XrayContext,
  capture: Partial<CaptureConfig> | undefined,
): void {
  const state = getContextState(ctx);
  if (!state || !capture) {
    return;
  }
  state.captureOverride = capture;
}

export function setRedactionOverride(
  ctx: XrayContext,
  redaction: Partial<RedactionConfig> | undefined,
): void {
  const state = getContextState(ctx);
  if (!state || !redaction) {
    return;
  }
  state.redactionOverride = redaction;
}
