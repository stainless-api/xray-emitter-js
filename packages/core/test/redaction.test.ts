import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRedaction } from '../src/redaction';
import type { RequestLog } from '../src/types';

const baseLog: RequestLog = {
  requestId: 'req-1',
  serviceName: 'svc',
  method: 'GET',
  url: 'https://example.test/path?token=abc&allow=ok',
  durationMs: 1,
  timestamp: new Date().toISOString(),
};

test('redacts configured headers', () => {
  const log: RequestLog = {
    ...baseLog,
    requestHeaders: {
      Authorization: 'Bearer secret-token',
      Cookie: 'a=1; b=2',
      'Set-Cookie': 'session=secret; Path=/',
      'X-Api-Key': 'abc123',
    },
  };

  const redacted = applyRedaction(
    {
      headers: ['authorization', 'cookie', 'set-cookie', 'x-api-key'],
      queryParams: [],
      bodyJsonPaths: [],
      replacement: '[REDACTED]',
    },
    log,
  );

  assert.equal(redacted.requestHeaders?.Authorization, 'Bearer [REDACTED]');
  assert.equal(redacted.requestHeaders?.Cookie, 'a=[REDACTED]; b=[REDACTED]');
  assert.equal(redacted.requestHeaders?.['Set-Cookie'], 'session=[REDACTED]; Path=/');
  assert.equal(redacted.requestHeaders?.['X-Api-Key'], '[REDACTED]');
});

test('redacts configured query params', () => {
  const redacted = applyRedaction(
    {
      headers: [],
      queryParams: ['token'],
      bodyJsonPaths: [],
      replacement: '[REDACTED]',
    },
    baseLog,
  );

  assert.equal(redacted.url.includes('token=%5BREDACTED%5D'), true);
  assert.equal(redacted.url.includes('allow=ok'), true);
});

test('redacts configured json paths', () => {
  const log: RequestLog = {
    ...baseLog,
    requestHeaders: {
      'content-type': 'application/json',
    },
    requestBody: {
      bytes: 25,
      encoding: 'utf8',
      truncated: false,
      value: JSON.stringify({ token: 'secret', nested: { id: '123' } }),
    },
  };

  const redacted = applyRedaction(
    {
      headers: [],
      queryParams: [],
      bodyJsonPaths: ['$.token', 'nested.id'],
      replacement: '[REDACTED]',
    },
    log,
  );

  const parsed = JSON.parse(redacted.requestBody?.value ?? '{}');
  assert.equal(parsed.token, '[REDACTED]');
  assert.equal(parsed.nested.id, '[REDACTED]');
});
