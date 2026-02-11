# X-ray for Next.js

Next.js integration for Stainless X-ray request logging. Wraps App Router route handlers (Next.js `Route Handlers`) in fetch-based runtimes.

## Install

```sh
pnpm add @stainlessdev/xray-emitter
```

## Basic usage (App Router route handler)

```ts
import { createEmitter, getXrayContext } from '@stainlessdev/xray-emitter/next';

const xray = createEmitter({ serviceName: 'my-service' });

export const POST = xray(async (req, ctx) => {
  const params = await ctx.params;
  const body = await req.text();
  getXrayContext(req)?.setUserId('user-123');
  return new Response(`id:${params.id ?? ''}:${body}`, { status: 200 });
});
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

If you already have an `XrayEmitter` instance, use `wrapNextRoute(handler, xray, options)`.

## Notes

- This package depends on OpenTelemetry packages as peer dependencies.
