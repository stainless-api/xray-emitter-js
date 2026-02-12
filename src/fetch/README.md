# X-ray for Fetch

Fetch API adapter for Stainless X-ray request logging. Use this in edge runtimes, web workers, or any environment with the Fetch API.

## Install

```sh
pnpm add @stainlessdev/xray-emitter
```

## Basic usage (Fetch handler)

```ts
import { createEmitter, wrapFetch } from '@stainlessdev/xray-emitter/fetch';

const xray = createEmitter({ serviceName: 'my-service' });

const handler = wrapFetch(async (_req) => {
  return new Response('ok', { status: 200 });
}, xray);
```

## Preserve request/response objects

If you need to keep the original `Request`/`Response` objects (for framework compatibility), use `wrapFetchPreserve`:

```ts
import { wrapFetchPreserve } from '@stainlessdev/xray-emitter/fetch';

const handler = wrapFetchPreserve(async (req) => {
  return new Response(await req.text());
}, xray);
```

## Access the X-ray context

```ts
import { getXrayContext } from '@stainlessdev/xray-emitter/fetch';

const handler = wrapFetch(async (req) => {
  const ctx = getXrayContext(req);
  ctx?.setUserId('user-123');
  return new Response('ok');
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

`wrapFetch(handler, xray, options)` and `wrapFetchPreserve(handler, xray, options)` share:

- `route`: override the route name for the request
- `requestId`: explicit request ID to use (prevents auto-generation)
- `capture`: per-request capture overrides
- `redaction`: per-request redaction overrides
- `onRequest(ctx)`, `onResponse(ctx, log)`, `onError(ctx, err)` hooks

## Notes

- Requires a global `fetch` when using the default exporter. If `fetch` is not available, provide `exporter.instance` or use `@stainlessdev/xray-emitter/node`.
- This package depends on OpenTelemetry packages as peer dependencies.
