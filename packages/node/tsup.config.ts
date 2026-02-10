import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    '@opentelemetry/api',
    '@opentelemetry/core',
    '@opentelemetry/exporter-trace-otlp-proto',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/semantic-conventions',
    '@stainlessdev/xray-core',
    '@stainlessdev/xray-node',
    '@stainlessdev/xray-fetch',
    'hono',
    'express',
    'fastify',
    'react-router',
    /^node:/,
  ],
  define: {
    __XRAY_VERSION__: JSON.stringify(pkg.version),
  },
});
