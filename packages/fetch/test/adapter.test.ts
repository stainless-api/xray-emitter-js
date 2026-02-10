import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { createEmitter } from '@stainlessdev/xray-core';
import { getXrayContext, wrapFetch, wrapFetchPreserve } from '../src/adapter';

const encoder = new TextEncoder();

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

test('wrapFetch captures request and response bodies', async () => {
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      capture: { requestBody: 'text', responseBody: 'text', maxBodyBytes: 1024 },
    },
    createNoopExporter(),
  );

  let captured: any;
  const wrapped = wrapFetch(
    async (req) => {
      const body = await req.text();
      return new Response(`echo:${body}`, { status: 200 });
    },
    xray,
    {
      onResponse: (_ctx, log) => {
        captured = log;
      },
    },
  );

  const response = await wrapped(
    new Request('https://example.test/thing', { method: 'POST', body: 'hello' }),
  );
  const text = await (response as { text: () => Promise<string> }).text();
  assert.equal(text, 'echo:hello');

  await delay(0);
  assert.ok(captured);
  assert.equal(captured.requestBody?.value, 'hello');
  assert.equal(captured.responseBody?.value, 'echo:hello');
});

test('wrapFetchPreserve does not replace request or response', async () => {
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      capture: { requestBody: 'text', responseBody: 'text', maxBodyBytes: 1024 },
    },
    createNoopExporter(),
  );

  let seenRequest: Request | null = null;
  let seenResponse: Response | null = null;

  const wrapped = wrapFetchPreserve(
    async (req) => {
      seenRequest = req;
      const body = await req.text();
      const response = new Response(`ok:${body}`, { status: 200 });
      seenResponse = response;
      return response;
    },
    xray,
    {
      onResponse: (_ctx, log) => {
        assert.equal(log.requestBody?.value, 'hello');
        assert.equal(log.responseBody?.value, 'ok:hello');
      },
    },
  );

  const request = new Request('https://example.test/preserve', {
    method: 'POST',
    body: 'hello',
  });
  const response = await wrapped(request);
  assert.equal(seenRequest, request);
  assert.equal(response, seenResponse);

  const text = await (response as { text: () => Promise<string> }).text();
  assert.equal(text, 'ok:hello');
});

test('getXrayContext returns context for request', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );
  const wrapped = wrapFetch(async () => new Response('ok'), xray);
  const request = new Request('https://example.test/ctx');
  const response = await wrapped(request);
  await (response as { text: () => Promise<string> }).text();

  const ctx = getXrayContext(request);
  assert.ok(ctx);
  assert.ok(ctx.requestId);
  assert.equal(typeof ctx.requestId, 'string');
  assert.equal(encoder.encode(ctx.requestId).length > 0, true);
});

test('wrapFetch adds Request-Id when missing', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );

  const wrapped = wrapFetch(async () => new Response('ok'), xray);
  const response = await wrapped(new Request('https://example.test/request-id'));

  const header = response.headers.get('request-id');
  assert.ok(header);
  assert.equal(typeof header, 'string');
});

test('wrapFetch writes explicit requestId when header missing', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );

  const wrapped = wrapFetch(async () => new Response('ok'), xray, {
    requestId: 'explicit-id',
  });
  const response: Response = await wrapped(new Request('https://example.test/explicit'));

  assert.equal(response.headers.get('request-id'), 'explicit-id');
});

test('wrapFetchPreserve preserves response unless header injection needed', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );

  let seen: Response | null = null;
  const wrapped = wrapFetchPreserve(async () => {
    const response = new Response('ok', {
      headers: { 'Request-Id': 'explicit-id' },
    });
    seen = response;
    return response;
  }, xray);

  const response: Response = await wrapped(new Request('https://example.test/explicit'));
  assert.equal(response.headers.get('request-id'), 'explicit-id');
  assert.equal(response, seen);
});

test('wrapFetchPreserve adds Request-Id when missing', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );

  const wrapped = wrapFetchPreserve(async () => new Response('ok'), xray);
  const response = await wrapped(new Request('https://example.test/missing'));

  const header = response.headers.get('request-id');
  assert.ok(header);
  assert.equal(typeof header, 'string');
});
