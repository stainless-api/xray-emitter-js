import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { createEmitter } from './emitter';
import { getContextState } from './state';

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

test('setActor logs when span attributes fail', () => {
  const errors: Array<{ msg: string; fields?: Record<string, unknown> }> = [];
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      logger: {
        debug() {},
        info() {},
        warn() {},
        error(msg, fields) {
          errors.push({ msg, fields });
        },
      },
      logLevel: 'warn',
    },
    createNoopExporter(),
  );

  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/actor-log-failure',
    headers: {},
    startTimeMs: 0,
  });
  const state = getContextState(ctx);
  assert.ok(state?.span);
  if (state?.span) {
    state.span.setAttribute = (() => {
      throw new Error('setAttribute failed');
    }) as typeof state.span.setAttribute;
  }

  ctx.setActor('tenant-123', 'user-123');

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.msg, 'xray: setActor failed');
  assert.equal(errors[0]?.fields?.['error'], 'setAttribute failed');
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

test('setUserId logs when span attributes fail', () => {
  const errors: Array<{ msg: string; fields?: Record<string, unknown> }> = [];
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      logger: {
        debug() {},
        info() {},
        warn() {},
        error(msg, fields) {
          errors.push({ msg, fields });
        },
      },
      logLevel: 'warn',
    },
    createNoopExporter(),
  );

  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/user-log-failure',
    headers: {},
    startTimeMs: 0,
  });
  const state = getContextState(ctx);
  assert.ok(state?.span);
  if (state?.span) {
    state.span.setAttribute = (() => {
      throw new Error('setAttribute failed');
    }) as typeof state.span.setAttribute;
  }

  ctx.setUserId('user-123');

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.msg, 'xray: setUserId failed');
  assert.equal(errors[0]?.fields?.['error'], 'setAttribute failed');
});

test('setTag records tags in log and span', async () => {
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
    url: 'https://example.test/tags',
    headers: {},
    startTimeMs: 0,
  });
  ctx.setTag('environment', 'staging');
  ctx.setTag('region', 'us-east-1');
  ctx.setTag('retries', 3);
  ctx.setTag('verbose', true);

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 5,
  });

  await xray.flush();
  assert.deepEqual(log.tags, {
    environment: 'staging',
    region: 'us-east-1',
    retries: 3,
    verbose: true,
  });
  const tagsAttr = spans[0]?.attributes['stainlessxray.internal.tags'];
  assert.equal(typeof tagsAttr, 'string');
  assert.deepEqual(JSON.parse(tagsAttr as string), {
    environment: 'staging',
    region: 'us-east-1',
    retries: 3,
    verbose: true,
  });
});

test('setTag overwrites previous value for same key', () => {
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
    },
    createNoopExporter(),
  );

  const ctx = xray.startRequest({
    method: 'GET',
    url: 'https://example.test/tags-overwrite',
    headers: {},
    startTimeMs: 0,
  });
  ctx.setTag('env', 'dev');
  ctx.setTag('env', 'prod');

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 5,
  });

  assert.deepEqual(log.tags, { env: 'prod' });
});

test('tags omitted from log and span when empty', async () => {
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
    url: 'https://example.test/no-tags',
    headers: {},
    startTimeMs: 0,
  });

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 5,
  });

  await xray.flush();
  assert.equal(log.tags, undefined);
  assert.equal('stainlessxray.internal.tags' in (spans[0]?.attributes ?? {}), false);
});

test('setTag treats __proto__ and constructor as plain keys', async () => {
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
    url: 'https://example.test/proto-tags',
    headers: {},
    startTimeMs: 0,
  });
  ctx.setTag('__proto__', 'poisoned');
  ctx.setTag('constructor', 'overwritten');
  ctx.setTag('toString', 42);

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 5,
  });

  await xray.flush();
  assert.equal(log.tags?.['__proto__'], 'poisoned');
  assert.equal(log.tags?.['constructor'], 'overwritten');
  assert.equal(log.tags?.['toString'], 42);
  assert.equal(Object.keys(log.tags!).length, 3);
  const parsed = JSON.parse(spans[0]?.attributes['stainlessxray.internal.tags'] as string);
  assert.equal(parsed['__proto__'], 'poisoned');
  assert.equal(parsed['constructor'], 'overwritten');
  assert.equal(parsed['toString'], 42);
});

test('setTag filters non-JSON-safe values from span attribute', async () => {
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
    url: 'https://example.test/unsafe-tags',
    headers: {},
    startTimeMs: 0,
  });
  ctx.setTag('safe', 'kept');
  ctx.setTag('bigint' as string, BigInt(42) as never);

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 5,
  });

  await xray.flush();
  // The log retains the raw tags as-is
  assert.equal(log.tags?.['safe'], 'kept');
  assert.equal(log.tags?.['bigint'], BigInt(42));
  // The span attribute only contains the JSON-safe subset
  const parsed = JSON.parse(spans[0]?.attributes['stainlessxray.internal.tags'] as string);
  assert.deepEqual(parsed, { safe: 'kept' });
});
