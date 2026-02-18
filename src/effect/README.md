# X-ray for Effect

Effect integration for Stainless X-ray request logging. Provides middleware for Effect's `HttpServer` that instruments incoming requests.

## Install

```sh
pnpm add @stainlessdev/xray-emitter effect @effect/platform
```

## Basic usage

```ts
import { createServer } from 'node:http';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServer, HttpServerResponse } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { createEmitter, currentXrayContext } from '@stainlessdev/xray-emitter/effect';

const xray = createEmitter({ serviceName: 'my-service' });

const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      const ctx = yield* currentXrayContext;
      ctx?.setActor('tenant-123', 'user-123');
      return HttpServerResponse.text('ok');
    }),
  ),
);

// Apply xray middleware, then serve
const app = xray(router);

const ServerLive = NodeHttpServer.layer(createServer, { port: 3000 });
const AppLive = app.pipe(HttpServer.serve(), Layer.provide(ServerLive));

NodeRuntime.runMain(Layer.launch(AppLive));
```

## Accessing the XrayContext

Inside an Effect handler you can access the context in two ways:

**Via `currentXrayContext` (recommended)** — an Effect that reads the `XrayContext` from the current `HttpServerRequest`:

```ts
import { currentXrayContext } from '@stainlessdev/xray-emitter/effect';

const handler = Effect.gen(function* () {
  const ctx = yield* currentXrayContext;
  ctx?.setActor('tenant-123', 'user-123');
  ctx?.setAttribute('plan', 'pro');
  return HttpServerResponse.text('ok');
});
```

**Via `getXrayContext`** — if you already have a reference to the `HttpServerRequest` object:

```ts
import { getXrayContext } from '@stainlessdev/xray-emitter/effect';

const ctx = getXrayContext(request);
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

If you already have an `XrayEmitter` instance, use `createEffectMiddleware(xray, options)`.

## Notes

- This package depends on OpenTelemetry packages as peer dependencies.
- `effect` and `@effect/platform` are peer dependencies — install them alongside the emitter.
