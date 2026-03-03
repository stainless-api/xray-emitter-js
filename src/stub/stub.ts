import http from 'node:http';
import { createRequire } from 'node:module';
import type { RequestLog, CapturedBody } from '../core/types';

const require = createRequire(import.meta.url);
const root: any = require('@opentelemetry/otlp-transformer/build/src/generated/root.js');

const ExportTraceServiceRequest =
  root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

export type { RequestLog };

export interface XrayStub {
  url: string;
  /** Request logs reconstructed from exported spans. */
  requestLogs: RequestLog[];
  close(): Promise<void>;
}

type SpanAttributes = Record<string, string | number | boolean | string[]>;

function decodeAttributes(attrs: any[]): SpanAttributes {
  const result: SpanAttributes = {};
  for (const attr of attrs) {
    const v = attr.value;
    if (v == null) continue;
    if (v.stringValue != null) result[attr.key] = v.stringValue;
    else if (v.intValue != null) result[attr.key] = Number(v.intValue);
    else if (v.doubleValue != null) result[attr.key] = v.doubleValue;
    else if (v.boolValue != null) result[attr.key] = v.boolValue;
    else if (v.arrayValue?.values) {
      result[attr.key] = v.arrayValue.values
        .map((item: any) => item.stringValue)
        .filter((s: any) => s != null);
    }
  }
  return result;
}

function buildCapturedBody(
  bodyValue: string | undefined,
  encoding: string | undefined,
  truncated: boolean | undefined,
  sizeBytes: number | undefined,
): CapturedBody | undefined {
  if (bodyValue == null) return undefined;
  return {
    bytes: sizeBytes ?? 0,
    encoding: (encoding as 'utf8' | 'base64') ?? 'utf8',
    truncated: truncated ?? false,
    value: bodyValue,
  };
}

function collectHeaders(
  attrs: SpanAttributes,
  prefix: string,
): Record<string, string | string[]> | undefined {
  const headers: Record<string, string | string[]> = {};
  let found = false;
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith(prefix)) {
      found = true;
      const headerName = key.slice(prefix.length);
      headers[headerName] = value as string | string[];
    }
  }
  return found ? headers : undefined;
}

const knownAttrPrefixes = [
  'http.',
  'url.',
  'client.',
  'server.',
  'network.',
  'service.',
  'enduser.',
  'stainlessxray.',
  'xray.',
  'otel.',
];

function collectCustomAttributes(
  attrs: SpanAttributes,
): Record<string, string | number | boolean | string[]> | undefined {
  const custom: Record<string, string | number | boolean | string[]> = {};
  let found = false;
  for (const [key, value] of Object.entries(attrs)) {
    if (knownAttrPrefixes.some((p) => key.startsWith(p))) continue;
    found = true;
    custom[key] = value;
  }
  return found ? custom : undefined;
}

function spanToRequestLog(attrs: SpanAttributes): RequestLog | undefined {
  const method = attrs['http.request.method'] as string | undefined;
  if (method == null) return undefined;

  return {
    requestId: (attrs['http.request.id'] as string) ?? '',
    serviceName: (attrs['service.name'] as string) ?? '',
    method,
    url: (attrs['url.full'] as string) ?? '',
    route: attrs['http.route'] as string | undefined,
    statusCode: attrs['http.response.status_code'] as number | undefined,
    durationMs: 0,
    requestHeaders: collectHeaders(attrs, 'http.request.header.'),
    responseHeaders: collectHeaders(attrs, 'http.response.header.'),
    requestBody: buildCapturedBody(
      attrs['http.request.body'] as string | undefined,
      attrs['http.request.body.encoding'] as string | undefined,
      attrs['http.request.body.truncated'] as boolean | undefined,
      attrs['http.request.body.size'] as number | undefined,
    ),
    responseBody: buildCapturedBody(
      attrs['http.response.body'] as string | undefined,
      attrs['http.response.body.encoding'] as string | undefined,
      attrs['http.response.body.truncated'] as boolean | undefined,
      attrs['http.response.body.size'] as number | undefined,
    ),
    tenantId: attrs['stainlessxray.tenant.id'] as string | undefined,
    userId: attrs['enduser.id'] as string | undefined,
    attributes: collectCustomAttributes(attrs),
    timestamp: '',
  };
}

function decodeRequestLogs(body: Buffer): RequestLog[] {
  const msg = ExportTraceServiceRequest.decode(body);
  const obj = ExportTraceServiceRequest.toObject(msg, { defaults: true });

  const logs: RequestLog[] = [];
  for (const rs of obj.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const attrs = decodeAttributes(span.attributes ?? []);
        const log = spanToRequestLog(attrs);
        if (log) logs.push(log);
      }
    }
  }
  return logs;
}

export function createStub(): Promise<XrayStub> {
  return new Promise((resolve) => {
    const requestLogs: RequestLog[] = [];

    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/traces') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const logs = decodeRequestLogs(body);
          requestLogs.push(...logs);

          res.writeHead(200);
          res.end();
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as import('node:net').AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        requestLogs,
        close() {
          return new Promise((resolve) => server.close(() => resolve()));
        },
      });
    });
  });
}
