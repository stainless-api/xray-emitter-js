import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { createEmitter } from './emitter';

function createNoopExporter(): SpanExporter {
  return {
    export(_spans, resultCallback) {
      resultCallback({ code: ExportResultCode.SUCCESS });
    },
    shutdown() {
      return Promise.resolve();
    },
  };
}

test('createEmitter allows custom exporter override', () => {
  assert.doesNotThrow(() =>
    createEmitter({
      serviceName: 'test',
      endpointUrl: 'https://collector',
      exporter: { instance: createNoopExporter() },
    }),
  );
});
