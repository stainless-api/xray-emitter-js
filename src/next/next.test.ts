import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { createEmitter, getXrayContext } from './next';

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

test('next integration captures body and route', async () => {
  let captured: any = null;
  const expectedUrl = 'https://example.test/widgets/123?source=test';
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
      route: '/widgets/[id]',
      onResponse: (_ctx, log) => {
        captured = log;
      },
    },
  );

  const handler = xray(async (req, ctx) => {
    const params = await ctx.params;
    const body = await req.text();
    const xrayCtx = getXrayContext(req);
    xrayCtx?.setUserId('user-123');
    return new Response(`next:${params.id ?? ''}:${body}`, { status: 200 });
  });

  const req = new Request(expectedUrl, {
    method: 'POST',
    body: 'hello',
  });
  const ctx = { params: Promise.resolve({ id: '123' }) };
  const response = await handler(req, ctx);
  const text = await response.text();
  assert.equal(text, 'next:123:hello');

  await delay(0);
  assert.ok(captured);
  assert.equal(captured.route, '/widgets/{id}');
  assert.equal(captured.url, expectedUrl);
  assert.equal(captured.requestBody?.value, 'hello');
  assert.equal(captured.responseBody?.value, 'next:123:hello');
});
