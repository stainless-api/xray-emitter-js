import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    express: 'src/express/express.ts',
    hono: 'src/hono/hono.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    '@opentelemetry/api',
    '@opentelemetry/core',
    '@opentelemetry/exporter-trace-otlp-proto',
    '@opentelemetry/exporter-trace-otlp-proto/build/src/platform/browser/index.js',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/semantic-conventions',
    '@stainlessdev/xray-core',
    '@stainlessdev/xray-node',
    '@stainlessdev/xray-fetch',
    /^node:/,
  ],
});
