# X-ray for Node.js

Node.js HTTP adapter for Stainless X-ray request logging. Use this for `node:http` servers or to power framework integrations (Express/Fastify).

## Install

```sh
pnpm add @stainlessdev/xray-emitter
```

## Basic usage (node:http)

```ts
import { createServer } from 'node:http';
import { createEmitter, wrapHttpHandler } from '@stainlessdev/xray-emitter/node';

const xray = createEmitter({ serviceName: 'my-service' });

const server = createServer(
  wrapHttpHandler((_req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('ok');
  }, xray),
);

server.listen(3000);
```

## Access the X-ray context

```ts
import { getXrayContext } from '@stainlessdev/xray-emitter/node';

const handler = wrapHttpHandler((req, res) => {
  const ctx = getXrayContext(req);
  ctx?.setActor('tenant-123', 'user-123');
  res.end('ok');
}, xray);
```

## Request IDs and response headers

X-ray will **auto-generate a request ID and inject it into your response headers** under the configured name (`requestId.header`, default `request-id`, emitted as `Request-Id`) if the header is missing. If you set your own request ID first (via `options.requestId` or by setting the response header yourself), X-ray preserves it and does not overwrite the header.

## Configuration

`createEmitter(config)` accepts `XrayRuntimeConfig`:

- `serviceName` (required)
- `endpointUrl` (required; falls back to `STAINLESS_XRAY_ENDPOINT_URL` when omitted; explicit `endpointUrl` wins)
- `environment`, `version`, `logger`, `logLevel`
- `exporter`: `endpointUrl`, `headers`, `timeoutMs`, `spanProcessor`, `instance` (custom SpanExporter)
- `capture`: request/response headers and bodies
- `redaction`: headers/query/body JSON-path redaction
- `requestId`: header name to read/write
- `route`: normalization options

## Adapter options (WrapOptions)

`wrapHttpHandler(handler, xray, options)` and `createEmitter(config, options?)` share:

- `route`: override the route name for the request
- `requestId`: explicit request ID to use (prevents auto-generation)
- `capture`: per-request capture overrides
- `redaction`: per-request redaction overrides
- `onRequest(ctx)`, `onResponse(ctx, log)`, `onError(ctx, err)` hooks

## Notes

- This package depends on OpenTelemetry packages as peer dependencies.
- Node.js >= 20 is required.
