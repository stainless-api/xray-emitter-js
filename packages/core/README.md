# @stainlessdev/xray-core

Core instrumentation for Stainless X-ray request logging. This package is runtime-agnostic and only provides the emitter, config, and types. Use it directly if you need a custom runtime or a custom OpenTelemetry exporter; otherwise prefer `@stainlessdev/xray-node` or `@stainlessdev/xray-fetch`.

## Install

```sh
pnpm add @stainlessdev/xray-core @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-proto
```

## Basic usage

```ts
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { createEmitter } from '@stainlessdev/xray-core';

const endpointUrl = 'http://localhost:4318';
const exporter = new OTLPTraceExporter({
  url: `${endpointUrl}/v1/traces`,
});

const xray = createEmitter(
  {
    serviceName: 'my-service',
    endpointUrl,
  },
  exporter,
);

const ctx = xray.startRequest({
  method: 'GET',
  url: 'https://example.com/hello',
  headers: { 'user-agent': 'curl/8.0' },
  startTimeMs: Date.now(),
});

const log = xray.endRequest(ctx, {
  statusCode: 200,
  headers: { 'request-id': 'req_123' },
  endTimeMs: Date.now(),
});

await xray.flush();
```

## Request IDs

X-ray always produces a request ID for each request. If you do not provide one, it resolves the ID in this order: explicit `requestId`, configured response header name (`requestId.header`, default: `request-id`), then an auto-generated UUIDv7-based ID. Runtime adapters inject the header automatically when missing; if you use `@stainlessdev/xray-core` directly, you are responsible for writing the response header yourself.

## Configuration (high-level)

`XrayConfig` lives in `packages/core/src/config.ts`. Common knobs:

- `serviceName` (required) and `endpointUrl` (falls back to `STAINLESS_XRAY_ENDPOINT_URL`).
- `exporter` overrides for OTLP headers, timeout, and span processor.
- `capture` and `redaction` toggles for headers/body logging.
- `requestId.header` for the response header name.
- `route` normalization options.

Notes:

- `endpointUrl` is required; `/v1/traces` is appended if missing. If both are set, `endpointUrl` wins over `STAINLESS_XRAY_ENDPOINT_URL`.
- If `endpointUrl` includes basic auth credentials, they are moved to the `Authorization` header automatically.

## When to use this package

Use `@stainlessdev/xray-core` only if you need to integrate with a custom runtime or supply your own `SpanExporter`. For Node and fetch-based runtimes, use `@stainlessdev/xray-node` or `@stainlessdev/xray-fetch` for a ready-to-go emitter and request/response adapters.
