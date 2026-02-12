// Use the bare package import so that Node.js resolves to the Node build (http
// transport) while bundlers (webpack, vite, wrangler/esbuild) follow the
// package.json "browser" field and resolve to the browser build automatically.
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import {
  createEmitter as createCoreEmitter,
  normalizeConfig,
  type XrayRuntimeConfig,
} from '../core/index';

export function createEmitter(config: XrayRuntimeConfig) {
  const resolved = normalizeConfig(config);
  const exporter =
    config.exporter?.instance ??
    new OTLPTraceExporter({
      url: resolved.exporter.endpointUrl,
      headers: resolved.exporter.headers ?? {},
      timeoutMillis: resolved.exporter.timeoutMs,
    });

  return createCoreEmitter(config, exporter);
}
