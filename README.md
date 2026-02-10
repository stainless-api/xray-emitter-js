# xray-js

Monorepo for Stainless X-ray request logging and OpenTelemetry instrumentation across Node.js and fetch-based runtimes.

## Packages

- `@stainlessdev/xray-core`
- `@stainlessdev/xray-node`
- `@stainlessdev/xray-fetch`
- `@stainlessdev/xray-express`
- `@stainlessdev/xray-fastify`
- `@stainlessdev/xray-hono`
- `@stainlessdev/xray-next`
- `@stainlessdev/xray-remix`

## Configuration

X-ray does not read standard OTEL environment variables. Configure an endpoint by passing
`endpointUrl` or setting `STAINLESS_XRAY_ENDPOINT_URL`. If both are set, `endpointUrl` wins. An
error is thrown if no endpoint is configured.

Recommended entrypoints:

- Node.js: `@stainlessdev/xray-node` (exports `createEmitter`)
- Fetch/edge: `@stainlessdev/xray-fetch` (exports `createEmitter`)

`@stainlessdev/xray-core` is runtime-agnostic; use it only if you supply a custom exporter instance
to `createEmitter`.

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
