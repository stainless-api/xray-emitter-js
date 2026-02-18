# X-ray emitter

Node and Typescript SDKs to emit request logs to Stainless X-ray.

## Getting started

```sh
npm add @stainlessdev/xray-emitter
```

Then using it in Express, for example:

```ts
import express from 'express';
import { createEmitter } from '@stainlessdev/xray-emitter/express';
import { getXrayContext } from '@stainlessdev/xray-emitter/node';

const app = express();

const xray = createEmitter({ serviceName: 'my-service' });

app.use(xray);

app.use((req, _res, next) => {
  const ctx = getXrayContext(req);
  ctx?.setActor('tenant-123', 'user-123');
  next();
});

app.get('/', (_req, res) => {
  res.send('ok');
});
```

## Supported frameworks

| Framework | Import | Docs | Example |
|-----------|--------|------|---------|
| Express | `@stainlessdev/xray-emitter/express` | [README](src/express/README.md) | [example](examples/express) |
| Fastify | `@stainlessdev/xray-emitter/fastify` | [README](src/fastify/README.md) | [example](examples/fastify) |
| Hono | `@stainlessdev/xray-emitter/hono` | [README](src/hono/README.md) | [example](examples/hono) |
| Next.js | `@stainlessdev/xray-emitter/next` | [README](src/next/README.md) | [example](examples/next-app) |
| Remix | `@stainlessdev/xray-emitter/remix` | [README](src/remix/README.md) | [example](examples/remix-app) |
| Effect | `@stainlessdev/xray-emitter/effect` | [README](src/effect/README.md) | [example](examples/effect) |

Lower-level adapters:

| Adapter | Import | Docs | Example |
|---------|--------|------|---------|
| Node.js (`node:http`) | `@stainlessdev/xray-emitter/node` | [README](src/node/README.md) | [example](examples/node-http) |
| Fetch / Edge | `@stainlessdev/xray-emitter/fetch` | [README](src/fetch/README.md) | [example](examples/edge) |
| Core | `@stainlessdev/xray-emitter` | [README](src/core/README.md) | — |

## Configuration

X-ray does not read standard OTEL environment variables. Configure an endpoint by passing
`endpointUrl` or setting `STAINLESS_XRAY_ENDPOINT_URL`. If both are set, `endpointUrl` wins. An
error is thrown if no endpoint is configured.

The core module (`@stainlessdev/xray-emitter`) is runtime-agnostic; use it only if you supply a
custom exporter instance to `createEmitter`.

### Request IDs

X-ray resolves request IDs from **response headers** when the span is closed. Configure the header name with `requestId.header` (default: `request-id`, emitted as `Request-Id`). Resolution order is: explicit `requestId` on the normalized request → response header lookup → UUIDv7 when missing.

If the configured response header is missing when the response is finalized, X-ray will set it (using the explicit ID when provided, otherwise a generated UUIDv7). Existing response headers are not overwritten.

### Fetch wrappers

`wrapFetch` may replace the request/response objects while capturing bodies. `wrapFetchPreserve` keeps the original request/response whenever possible, but it may replace the response if it needs to inject a missing `Request-Id` header.

## Development

```sh
pnpm install
pnpm build
pnpm test
```
