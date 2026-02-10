# @stainlessdev/xray-remix

Remix integration for Stainless X-ray request logging. Wraps Remix/React Router request handlers in fetch-based runtimes.

## Install

```sh
pnpm add @stainlessdev/xray-remix
```

## Basic usage

```ts
import type { RequestHandler } from 'react-router';
import { createEmitter, getXrayContext } from '@stainlessdev/xray-remix';

const xray = createEmitter({
  serviceName: 'my-service',
  endpointUrl: 'http://localhost:4318',
});

const handler: RequestHandler = async (request) => {
  getXrayContext(request)?.setUserId('user-123');
  const body = await request.text();
  return new Response(`remix:${body}`, { status: 200 });
};

export default xray(handler);
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

If you already have an `XrayEmitter` instance, use `wrapRemixRequestHandler(handler, xray, options)`.

## Notes

- This package depends on OpenTelemetry packages as peer dependencies.
