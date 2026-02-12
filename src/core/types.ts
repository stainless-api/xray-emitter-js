export type AttributeValue = string | number | boolean | string[] | number[] | boolean[];
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface CapturedBody {
  bytes: number;
  encoding: 'utf8' | 'base64';
  truncated: boolean;
  value?: string;
}

export interface RequestLog {
  requestId: string;
  traceId?: string;
  spanId?: string;
  serviceName: string;
  method: string;
  url: string;
  route?: string;
  statusCode?: number;
  durationMs: number;
  requestHeaders?: Record<string, string | string[]>;
  responseHeaders?: Record<string, string | string[]>;
  requestBody?: CapturedBody;
  responseBody?: CapturedBody;
  userId?: string;
  sessionId?: string;
  error?: { message: string; type?: string; stack?: string };
  attributes?: Record<string, AttributeValue>;
  timestamp: string;
}

export interface XrayContext {
  requestId: string;
  traceId?: string;
  spanId?: string;
  setUserId(id: string): void;
  setSessionId(id: string): void;
  setAttribute(key: string, value: AttributeValue): void;
  addEvent(name: string, attributes?: Record<string, AttributeValue>): void;
  setError(err: unknown): void;
}

export interface NormalizedRequest {
  method: string;
  url: string;
  route?: string;
  headers: Record<string, string | string[]>;
  body?: CapturedBody;
  /**
   * Optional explicit request ID. If omitted, X-ray reads from response headers
   * when the span is closed (and generates a UUIDv7 if none is present).
   */
  requestId?: string;
  remoteAddress?: string;
  startTimeMs: number;
}

export interface NormalizedResponse {
  statusCode?: number;
  headers?: Record<string, string | string[]>;
  body?: CapturedBody;
  endTimeMs: number;
}

export interface XrayEmitter {
  config: import('./config').ResolvedXrayConfig;
  startRequest(req: NormalizedRequest): XrayContext;
  endRequest(ctx: XrayContext, res: NormalizedResponse, err?: unknown): RequestLog;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
