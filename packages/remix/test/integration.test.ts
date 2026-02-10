import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { RequestHandler } from 'react-router';
import { createEmitter, getXrayContext } from '../src/index';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

test('remix integration captures body and route', async () => {
  let captured: any = null;
  const expectedUrl = 'https://example.test/remix/123?source=test';
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      capture: {
        requestBody: 'text',
        responseBody: 'text',
        maxBodyBytes: 1024,
      },
      exporter: {
        instance: createNoopExporter(),
      },
    },
    {
      route: '/remix/:id',
      onResponse: (_ctx, log) => {
        captured = log;
      },
    },
  );

  const baseHandler: RequestHandler = async (request) => {
    const xrayCtx = getXrayContext(request);
    xrayCtx?.setUserId('user-123');
    const body = await request.text();
    return new Response(`remix:${body}`, { status: 200 });
  };

  const handler = xray(baseHandler);

  const response = await handler(
    new Request(expectedUrl, {
      method: 'POST',
      body: 'hello',
    }),
    {},
  );
  const text = await response.text();
  assert.equal(text, 'remix:hello');

  await delay(0);
  assert.ok(captured);
  assert.equal(captured.route, '/remix/{id}');
  assert.equal(captured.url, expectedUrl);
  assert.equal(captured.requestBody?.value, 'hello');
  assert.equal(captured.responseBody?.value, 'remix:hello');
});
