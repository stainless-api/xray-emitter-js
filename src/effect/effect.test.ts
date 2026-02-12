import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { Effect } from 'effect';
import { HttpApp, HttpRouter, HttpServerResponse } from '@effect/platform';
import { createEmitter, currentXrayContext } from './effect';

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

test('effect integration captures route, url, and bodies', async () => {
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
      exporter: { instance: createNoopExporter() },
    },
    {
      onResponse: (_ctx, log) => {
        captured = log;
      },
    },
  );

  const router = HttpRouter.empty.pipe(
    HttpRouter.post('/users/:id', Effect.succeed(HttpServerResponse.text('user:123'))),
    HttpRouter.use(xray),
  );

  const handler = HttpApp.toWebHandler(router as HttpApp.Default<any>);

  const response = await handler(
    new Request(expectedUrl, {
      method: 'POST',
      body: 'hello',
    }),
  );
  const text = await response.text();
  assert.equal(text, 'user:123');

  assert.ok(captured);
  assert.equal(captured.method, 'POST');
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.route, '/users/{id}');
  assert.equal(captured.url, expectedUrl);
  assert.equal(captured.requestBody?.value, 'hello');
  assert.equal(captured.responseBody?.value, 'user:123');
});

test('effect integration captures errors', async () => {
  let captured: any = null;
  let capturedError: any = null;

  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      exporter: { instance: createNoopExporter() },
    },
    {
      onResponse: (_ctx, log) => {
        captured = log;
      },
      onError: (_ctx, err) => {
        capturedError = err;
      },
    },
  );

  const app = Effect.fail(new Error('test error'));
  const wrappedApp = xray(app);
  const handler = HttpApp.toWebHandler(wrappedApp);

  await handler(new Request('http://example.test/fail', { method: 'POST' }));

  assert.ok(captured);
  assert.equal(captured.method, 'POST');
  assert.ok(captured.url.includes('/fail'));
  assert.ok(captured.error);
  assert.ok(capturedError);
});

test('effect integration provides xray context', async () => {
  let captured: any = null;

  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      exporter: { instance: createNoopExporter() },
    },
    {
      onResponse: (_ctx, log) => {
        captured = log;
      },
    },
  );

  const app = Effect.gen(function* () {
    const ctx = yield* currentXrayContext;
    ctx?.setUserId('user-42');
    ctx?.setAttribute('plan', 'pro');
    return HttpServerResponse.text('ok');
  });

  const wrappedApp = xray(app);
  const handler = HttpApp.toWebHandler(wrappedApp);

  const response = await handler(new Request('http://example.test/ctx', { method: 'GET' }));

  const text = await response.text();
  assert.equal(text, 'ok');

  assert.ok(captured);
  assert.equal(captured.userId, 'user-42');
});
