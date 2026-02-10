import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { Hono } from 'hono';
import { createEmitter, HonoXrayEnv } from '../src/index';

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

test('hono integration captures route and body', async () => {
  let captured: any = null;
  const expectedUrl = 'http://example.test/users/123?source=test';
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
      onResponse: (_ctx, log) => {
        captured = log;
      },
    },
  );

  const app = new Hono<HonoXrayEnv>();
  app.use('*', xray);

  app.post('/users/:id', async (c) => {
    const body = await c.req.text();
    return c.text(`user:${c.req.param('id')}:${body}`);
  });

  const response = await app.fetch(
    new Request(expectedUrl, {
      method: 'POST',
      body: 'hello',
    }),
  );
  const text = await response.text();
  assert.equal(text, 'user:123:hello');

  await delay(0);
  assert.ok(captured);
  assert.equal(captured.route, '/users/{id}');
  assert.equal(captured.url, expectedUrl);
  assert.equal(captured.requestBody?.value, 'hello');
  assert.equal(captured.responseBody?.value, 'user:123:hello');
});
