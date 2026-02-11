export type {
  AttributeValue,
  CapturedBody,
  LogLevel,
  Logger,
  NormalizedRequest,
  NormalizedResponse,
  RequestLog,
  XrayContext,
  XrayEmitter,
} from './types';
export type {
  CaptureConfig,
  ExporterConfig,
  RedactionConfig,
  RequestIdConfig,
  ResolvedXrayConfig,
  RouteConfig,
  XrayConfig,
  XrayRuntimeConfig,
} from './config';
export { XrayConfigError, normalizeConfig } from './config';
export { createEmitter } from './emitter';
