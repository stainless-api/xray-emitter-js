# X-ray for Express

Express integration for Stainless X-ray request logging. Provides a middleware that wraps Express requests and responses.

## Install

```sh
pnpm add @stainlessdev/xray-emitter
```

## Basic usage

```ts
import express from 'express';
import { createEmitter } from '@stainlessdev/xray-emitter/express';
import { getXrayContext } from '@stainlessdev/xray-emitter/node';

const app = express();

const xray = createEmitter({ serviceName: 'my-service' });

app.use(xray);

app.use((req, _res, next) => {
  const ctx = getXrayContext(req);
  ctx?.setUserId('user-123');
  next();
});

app.get('/', (_req, res) => {
  res.send('ok');
});
```

The middleware also attaches the context to `req.xray` and `res.locals.xray` for convenience.

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

If you already have an `XrayEmitter` instance, use `createExpressMiddleware(xray, options)` to create middleware.

## Notes

- This package depends on OpenTelemetry packages as peer dependencies.
- Node.js >= 20 is required.
