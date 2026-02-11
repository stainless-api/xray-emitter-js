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

function withFetchDisabled(fn: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', {
    value: undefined,
    writable: true,
    configurable: true,
  });
  try {
    fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'fetch', descriptor);
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  }
}

test('createEmitter throws when fetch is missing without exporter override', () => {
  withFetchDisabled(() => {
    assert.throws(
      () =>
        createEmitter({
          serviceName: 'test',
          endpointUrl: 'https://collector',
        }),
      /fetch/i,
    );
  });
});

test('createEmitter allows custom exporter without fetch', () => {
  withFetchDisabled(() => {
    assert.doesNotThrow(() =>
      createEmitter({
        serviceName: 'test',
        endpointUrl: 'https://collector',
        exporter: { instance: createNoopExporter() },
      }),
    );
  });
});
