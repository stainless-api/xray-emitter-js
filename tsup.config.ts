import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/core/index.ts',
    internal: 'src/core/internal.ts',
    node: 'src/node/node.ts',
    fetch: 'src/fetch/fetch.ts',
    express: 'src/express/express.ts',
    hono: 'src/hono/hono.ts',
    fastify: 'src/fastify/fastify.ts',
    next: 'src/next/next.ts',
    remix: 'src/remix/remix.ts',
    effect: 'src/effect/effect.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  external: [
    '@opentelemetry/api',
    '@opentelemetry/core',
    '@opentelemetry/exporter-trace-otlp-proto',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/semantic-conventions',
    /^node:/,
    'effect',
    /^@effect\//,
  ],
});
