import assert from 'node:assert/strict';
import test from 'node:test';
import type { Span } from '@opentelemetry/api';
import * as attributes from './attributes';

class TestSpan {
  attributes: Record<string, unknown> = {};

  setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }
}

function makeSpan(): TestSpan {
  return new TestSpan();
}

test('setHeaderAttributes coerces header values to arrays', () => {
  const span = makeSpan();
  attributes.setHeaderAttributes(
    span as unknown as Span,
    {
      'X-Request-Id': 'req-123',
      'set-cookie': ['a=1', 'b=2'],
    },
    'http.request.header.',
  );

  assert.deepEqual(span.attributes['http.request.header.x-request-id'], ['req-123']);
  assert.deepEqual(span.attributes['http.request.header.set-cookie'], ['a=1', 'b=2']);
});

test('setRequestAttributes uses otel http keys and captures url.path', () => {
  const span = makeSpan();
  attributes.setRequestAttributes(
    span as unknown as Span,
    { method: 'POST' },
    'https://example.test/api/v1/items?x=1#frag',
  );

  assert.equal(span.attributes['http.request.method'], 'POST');
  assert.equal(span.attributes['url.full'], 'https://example.test/api/v1/items?x=1#frag');
  assert.equal(span.attributes['url.path'], '/api/v1/items');
  assert.equal('http.method' in span.attributes, false);
});

test('setRequestAttributes extracts path from a relative URL', () => {
  const span = makeSpan();
  attributes.setRequestAttributes(span as unknown as Span, { method: 'GET' }, '/items/42?x=1#frag');

  assert.equal(span.attributes['url.path'], '/items/42');
});

test('setRequestAttributes derives client.address from Forwarded headers', () => {
  const span = makeSpan();
  attributes.setRequestAttributes(
    span as unknown as Span,
    {
      method: 'GET',
      headers: {
        Forwarded: 'for="[2001:db8::1]:4711";proto=https, for=192.0.2.43',
        'X-Forwarded-For': '198.51.100.17',
      },
      remoteAddress: '203.0.113.5',
    },
    'https://example.test/',
  );

  assert.equal(span.attributes['client.address'], '2001:db8::1');
});

test('setRequestAttributes falls back to x-forwarded-for and x-real-ip', () => {
  const span = makeSpan();
  attributes.setRequestAttributes(
    span as unknown as Span,
    {
      method: 'GET',
      headers: {
        forwarded: 'for=unknown',
        'x-forwarded-for': '203.0.113.195:1234, 70.41.3.18',
        'x-real-ip': '198.51.100.17',
      },
      remoteAddress: '192.0.2.1',
    },
    'https://example.test',
  );

  assert.equal(span.attributes['client.address'], '203.0.113.195');
});

test('setRequestAttributes uses remoteAddress when no proxy headers are present', () => {
  const span = makeSpan();
  attributes.setRequestAttributes(
    span as unknown as Span,
    { method: 'GET', remoteAddress: '192.0.2.1:1234' },
    'https://example.test',
  );

  assert.equal(span.attributes['client.address'], '192.0.2.1');
});

test('setRequestAttributes falls back to x-real-ip when x-forwarded-for is empty', () => {
  const span = makeSpan();
  attributes.setRequestAttributes(
    span as unknown as Span,
    {
      method: 'GET',
      headers: {
        'x-forwarded-for': ' ',
        'x-real-ip': '198.51.100.22',
      },
      remoteAddress: '192.0.2.55',
    },
    'https://example.test',
  );

  assert.equal(span.attributes['client.address'], '198.51.100.22');
});

test('setRequestAttributes ignores redacted forwarding headers', () => {
  const span = makeSpan();
  attributes.setRequestAttributes(
    span as unknown as Span,
    {
      method: 'GET',
      headers: {
        'x-forwarded-for': '[REDACTED]',
      },
      remoteAddress: '192.0.2.99',
      redactionReplacement: '[REDACTED]',
    },
    'https://example.test',
  );

  assert.equal(span.attributes['client.address'], '192.0.2.99');
});

test('setRequestAttributes preserves IPv6 addresses without brackets', () => {
  const span = makeSpan();
  attributes.setRequestAttributes(
    span as unknown as Span,
    {
      method: 'GET',
      headers: { 'x-real-ip': '2001:db8::1' },
    },
    'https://example.test',
  );

  assert.equal(span.attributes['client.address'], '2001:db8::1');
});

test('setResponseStatusAttribute uses otel http response status key', () => {
  const span = makeSpan();
  attributes.setResponseStatusAttribute(span as unknown as Span, 204);

  assert.equal(span.attributes['http.response.status_code'], 204);
  assert.equal('http.status_code' in span.attributes, false);
});

test('setRequestIdAttribute sets http.request.id', () => {
  const span = makeSpan();
  const setRequestIdAttribute = (attributes as Record<string, unknown>).setRequestIdAttribute as
    | ((span: Span, requestId: string) => void)
    | undefined;

  assert.equal(typeof setRequestIdAttribute, 'function');
  setRequestIdAttribute?.(span as unknown as Span, 'req-123');
  assert.equal(span.attributes['http.request.id'], 'req-123');
});
