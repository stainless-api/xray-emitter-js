// Force the browser/worker exporter to avoid Node http resolution in edge runtimes.
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto/build/src/platform/browser/index.js';
import {
  createEmitter as createCoreEmitter,
  normalizeConfig,
  type XrayRuntimeConfig,
} from '../core/index';

export function createEmitter(config: XrayRuntimeConfig) {
  if (!config.exporter?.instance) {
    const hasFetch = typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function';
    if (!hasFetch) {
      throw new Error(
        'fetch is required to use the default @stainlessdev/xray-fetch exporter; provide exporter.instance or use @stainlessdev/xray-node instead.',
      );
    }
  }

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
