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
  ctx.setActor({ tenantId: 'tenant-123', userId: 'user-123' });

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

test('setActor records all fields', async () => {
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
    url: 'https://example.test/actor-all',
    headers: {},
    startTimeMs: 0,
  });
  ctx.setActor({
    tenantId: 'tenant-123',
    tenantSlug: 'acme-corp',
    userEmail: 'jane@example.com',
    userFullName: 'Jane Doe',
    userId: 'user-456',
    userName: 'jdoe',
  });

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 5,
  });

  await xray.flush();
  assert.equal(log.tenantId, 'tenant-123');
  assert.equal(log.tenantSlug, 'acme-corp');
  assert.equal(log.userEmail, 'jane@example.com');
  assert.equal(log.userFullName, 'Jane Doe');
  assert.equal(log.userId, 'user-456');
  assert.equal(log.userName, 'jdoe');
  assert.equal(spans[0]?.attributes['stainlessxray.tenant.id'], 'tenant-123');
  assert.equal(spans[0]?.attributes['stainlessxray.tenant.slug'], 'acme-corp');
  assert.equal(spans[0]?.attributes['user.email'], 'jane@example.com');
  assert.equal(spans[0]?.attributes['user.full_name'], 'Jane Doe');
  assert.equal(spans[0]?.attributes['user.id'], 'user-456');
  assert.equal(spans[0]?.attributes['user.name'], 'jdoe');
});

test('setActor records only required fields when optional fields omitted', async () => {
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
    url: 'https://example.test/actor-required-only',
    headers: {},
    startTimeMs: 0,
  });
  ctx.setActor({ tenantId: 'tenant-123', userId: 'user-456' });

  const log = xray.endRequest(ctx, {
    statusCode: 200,
    headers: {},
    endTimeMs: 5,
  });

  await xray.flush();
  assert.equal(log.tenantId, 'tenant-123');
  assert.equal(log.userId, 'user-456');
  assert.equal(log.tenantSlug, undefined);
  assert.equal(log.userEmail, undefined);
  assert.equal(log.userFullName, undefined);
  assert.equal(log.userName, undefined);
  assert.equal(spans[0]?.attributes['stainlessxray.tenant.id'], 'tenant-123');
  assert.equal(spans[0]?.attributes['user.id'], 'user-456');
  assert.equal('stainlessxray.tenant.slug' in (spans[0]?.attributes ?? {}), false);
  assert.equal('user.email' in (spans[0]?.attributes ?? {}), false);
  assert.equal('user.full_name' in (spans[0]?.attributes ?? {}), false);
  assert.equal('user.name' in (spans[0]?.attributes ?? {}), false);
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

  ctx.setActor({ tenantId: 'tenant-123', userId: 'user-123' });

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
