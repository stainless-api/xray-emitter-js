# X-ray for Fastify

Fastify integration for Stainless X-ray request logging. Registers hooks that wrap Fastify requests and responses.

## Install

```sh
pnpm add @stainlessdev/xray-emitter
```

## Basic usage

```ts
import Fastify from 'fastify';
import { createEmitter } from '@stainlessdev/xray-emitter/fastify';

const app = Fastify();

const xray = createEmitter({ serviceName: 'my-service' });

xray(app);

app.addHook('onRequest', async (request) => {
  request.xray?.setActor('tenant-123', 'user-123');
});

app.get('/', async () => ({ ok: true }));
```

## Request IDs and response headers

X-ray will **auto-generate a request ID and inject it into your response headers** under the configured name (`requestId.header`, default `request-id`, emitted as `Request-Id`) if the header is missing. If you set your own request ID first (via `options.requestId` or by setting the response header yourself), X-ray preserves it and does not overwrite the header.

## Configuration

`createEmitter(config, options?)` accepts `XrayRuntimeConfig` (config) and `WrapOptions` (per-request defaults):

- `serviceName` (required)
- `endpointUrl` (required; falls back to `STAINLESS_XRAY_ENDPOINT_URL` when omitted; explicit `endpointUrl` wins)
- `environment`, `version`, `logger`, `logLevel`
- `exporter`: `endpointUrl`, `headers`, `timeoutMs`, `spanProcessor`, `instance` (custom SpanExporter)
- `capture`: request/response headers and bodies
- `redaction`: headers/query/body JSON-path redaction
- `requestId`: header name to read/write
- `route`: normalization options

## Adapter options (WrapOptions)

- `route`: override the route name for the request
- `requestId`: explicit request ID to use (prevents auto-generation)
- `capture`: per-request capture overrides
- `redaction`: per-request redaction overrides
- `onRequest(ctx)`, `onResponse(ctx, log)`, `onError(ctx, err)` hooks

## Advanced usage

If you already have an `XrayEmitter` instance, use `addFastifyHooks(app, xray, options)`.

## Notes

- This package depends on OpenTelemetry packages as peer dependencies.
- Node.js >= 20 is required.
