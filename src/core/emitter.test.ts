import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
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

function createRecordingExporter(spans: ReadableSpan[]): SpanExporter {
  return {
    export(batch, resultCallback) {
      spans.push(...batch);
      resultCallback({ code: ExportResultCode.SUCCESS });
    },
    shutdown() {
      return Promise.resolve();
    },
  };
}

test('client.address respects redacted forwarding headers', async () => {
  const spans: ReadableSpan[] = [];
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      exporter: { spanProcessor: 'simple' },
      redaction: { headers: ['x-forwarded-for'], replacement: '[REDACTED]' },
    },
    createRecordingExporter(spans),
  );

  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/info',
    headers: { 'x-forwarded-for': '203.0.113.5' },
    remoteAddress: '192.0.2.10',
    startTimeMs: 1000,
  });

  xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 1005,
  });

  await xray.flush();
  assert.equal(spans.length, 1);
  assert.equal(spans[0]?.attributes['client.address'], '192.0.2.10');
});

test('endRequest computes duration from start/end times', () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );
  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/slow',
    headers: {},
    startTimeMs: 1000,
  });

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 1123,
  });

  assert.equal(log.durationMs, 123);
});

test('endRequest resolves requestId from explicit before response header', () => {
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      requestId: { header: 'request-id' },
    },
    createNoopExporter(),
  );

  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/explicit',
    headers: {},
    requestId: 'explicit-id',
    startTimeMs: 0,
  });
  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: { 'Request-Id': 'header-id' },
    endTimeMs: 5,
  });
  assert.equal(log.requestId, 'explicit-id');
  assert.equal(ctx.requestId, 'explicit-id');
});

test('endRequest resolves requestId from response header when explicit missing', () => {
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      requestId: { header: 'request-id' },
    },
    createNoopExporter(),
  );

  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/header',
    headers: {},
    startTimeMs: 0,
  });

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: { 'Request-Id': 'header-id' },
    endTimeMs: 10,
  });

  assert.equal(log.requestId, 'header-id');
  assert.equal(ctx.requestId, 'header-id');
});

test('endRequest generates requestId when missing', () => {
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      requestId: { header: 'request-id' },
    },
    createNoopExporter(),
  );

  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/missing',
    headers: {},
    startTimeMs: 0,
  });

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 10,
  });

  assert.ok(log.requestId);
  assert.equal(typeof log.requestId, 'string');
  assert.ok(ctx.requestId);
  assert.equal(typeof ctx.requestId, 'string');
});

test('setActor records tenant and user IDs', async () => {
  const spans: ReadableSpan[] = [];
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      exporter: { spanProcessor: 'simple' },
    },
    createRecordingExporter(spans),
  );

  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/actor',
    headers: {},
    startTimeMs: 0,
  });
  ctx.setActor('tenant-123', 'user-123');

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 5,
  });

  await xray.flush();
  assert.equal(log.tenantId, 'tenant-123');
  assert.equal(log.userId, 'user-123');
  assert.equal(spans[0]?.attributes['stainlessxray.tenant.id'], 'tenant-123');
  assert.equal(spans[0]?.attributes['user.id'], 'user-123');
});

test('setActor can record tenant without user', async () => {
  const spans: ReadableSpan[] = [];
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      exporter: { spanProcessor: 'simple' },
    },
    createRecordingExporter(spans),
  );

  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/actor-tenant-only',
    headers: {},
    startTimeMs: 0,
  });
  ctx.setActor('tenant-123', '');

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 5,
  });

  await xray.flush();
  assert.equal(log.tenantId, 'tenant-123');
  assert.equal(log.userId, undefined);
  assert.equal(spans[0]?.attributes['stainlessxray.tenant.id'], 'tenant-123');
  assert.equal('user.id' in (spans[0]?.attributes ?? {}), false);
});

test('setUserId remains supported for compatibility', () => {
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
    },
    createNoopExporter(),
  );

  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/user-only',
    headers: {},
    startTimeMs: 0,
  });
  ctx.setUserId('user-legacy');

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 5,
  });

  assert.equal(log.userId, 'user-legacy');
});
