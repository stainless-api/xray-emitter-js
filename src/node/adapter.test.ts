import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { createEmitter } from '../core/emitter';
import { wrapHttpHandler } from './adapter';

async function withServer(
  handler: http.RequestListener,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('unexpected server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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

test('wrapHttpHandler calls onError for async rejection', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );
  let onErrorCalled = 0;

  await withServer(
    wrapHttpHandler(
      (_req, res) => {
        res.statusCode = 500;
        res.end('error');
        return Promise.reject(new Error('boom'));
      },
      xray,
      {
        onError: () => {
          onErrorCalled += 1;
        },
      },
    ),
    async (baseUrl) => {
      const response = await fetch(baseUrl);
      assert.equal(response.status, 500);
      const text = await response.text();
      assert.equal(text, 'error');
    },
  );

  assert.equal(onErrorCalled, 1);
});

test('wrapHttpHandler captures request and response bodies', async () => {
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
      capture: { requestBody: 'text', responseBody: 'text', maxBodyBytes: 1024 },
    },
    createNoopExporter(),
  );

  let captured: any = null;

  await withServer(
    wrapHttpHandler(
      async (req, res) => {
        req.setEncoding('utf-8');
        let body = '';
        for await (const chunk of req) {
          body += chunk;
        }
        res.statusCode = 200;
        res.end(`echo:${body}`);
      },
      xray,
      {
        route: '/echo',
        onResponse: (_ctx, log) => {
          captured = log;
        },
      },
    ),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/echo`, { method: 'POST', body: 'hello' });
      const text = await response.text();
      assert.equal(text, 'echo:hello');
    },
  );

  assert.ok(captured);
  assert.equal(captured.route, '/echo');
  assert.equal(captured.requestBody?.value, 'hello');
  assert.equal(captured.responseBody?.value, 'echo:hello');
});

test('wrapHttpHandler prefers originalUrl when present', async () => {
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
    },
    createNoopExporter(),
  );

  let captured: any = null;
  let expectedUrl = '';

  const wrapped = wrapHttpHandler(
    (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    },
    xray,
    {
      onResponse: (_ctx, log) => {
        captured = log;
      },
    },
  );

  await withServer(
    (req, res) => {
      (req as typeof req & { originalUrl?: string }).originalUrl = req.url ?? '';
      req.url = (req.url ?? '').replace('/mounted', '');
      wrapped(req, res);
    },
    async (baseUrl) => {
      expectedUrl = new URL('/mounted/items/42?source=test', baseUrl).toString();
      const response = await fetch(expectedUrl);
      assert.equal(response.status, 200);
      await response.text();
    },
  );

  assert.ok(captured);
  assert.equal(captured.url, expectedUrl);
});

test('wrapHttpHandler keeps absolute req.url when originalUrl is set', async () => {
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
    },
    createNoopExporter(),
  );

  let captured: any = null;
  let expectedAbsoluteUrl = '';

  const wrapped = wrapHttpHandler(
    (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    },
    xray,
    {
      onResponse: (_ctx, log) => {
        captured = log;
      },
    },
  );

  await withServer(
    (req, res) => {
      const host = typeof req.headers.host === 'string' ? req.headers.host : '127.0.0.1';
      expectedAbsoluteUrl = `http://${host}/absolute/path?source=test`;
      req.url = expectedAbsoluteUrl;
      (req as typeof req & { originalUrl?: string }).originalUrl = '/should-not-be-used';
      wrapped(req, res);
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/placeholder`);
      assert.equal(response.status, 200);
      await response.text();
    },
  );

  assert.ok(captured);
  assert.equal(captured.url, expectedAbsoluteUrl);
});

test('wrapHttpHandler adds Request-Id when missing', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );

  await withServer(
    wrapHttpHandler((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    }, xray),
    async (baseUrl) => {
      const response = await fetch(baseUrl);
      const header = response.headers.get('request-id');
      assert.ok(header);
      assert.equal(typeof header, 'string');
      const text = await response.text();
      assert.equal(text, 'ok');
    },
  );
});

test('wrapHttpHandler uses Request-Id from writeHead headers', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );

  let seenLog: any = null;
  await withServer(
    wrapHttpHandler(
      (_req, res) => {
        res.writeHead(200, { 'Request-Id': 'writehead-id' });
        res.end('ok');
      },
      xray,
      {
        onResponse: (_ctx, log) => {
          seenLog = log;
        },
      },
    ),
    async (baseUrl) => {
      const response = await fetch(baseUrl);
      assert.equal(response.headers.get('request-id'), 'writehead-id');
      await response.text();
    },
  );

  assert.ok(seenLog);
  assert.equal(seenLog.requestId, 'writehead-id');
});

test('wrapHttpHandler uses Request-Id from writeHead header array', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );

  let seenLog: any = null;
  await withServer(
    wrapHttpHandler(
      (_req, res) => {
        res.writeHead(200, ['Request-Id', 'array-id', 'Content-Type', 'text/plain']);
        res.end('ok');
      },
      xray,
      {
        onResponse: (_ctx, log) => {
          seenLog = log;
        },
      },
    ),
    async (baseUrl) => {
      const response = await fetch(baseUrl);
      assert.equal(response.headers.get('request-id'), 'array-id');
      await response.text();
    },
  );

  assert.ok(seenLog);
  assert.equal(seenLog.requestId, 'array-id');
});

test('wrapHttpHandler uses explicit requestId without overriding header', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );

  let seenLog: any = null;
  await withServer(
    wrapHttpHandler(
      (_req, res) => {
        res.setHeader('Request-Id', 'header-id');
        res.statusCode = 200;
        res.end('ok');
      },
      xray,
      {
        requestId: 'explicit-id',
        onResponse: (_ctx, log) => {
          seenLog = log;
        },
      },
    ),
    async (baseUrl) => {
      const response = await fetch(baseUrl);
      assert.equal(response.headers.get('request-id'), 'header-id');
      await response.text();
    },
  );

  assert.ok(seenLog);
  assert.equal(seenLog.requestId, 'explicit-id');
});

test('wrapHttpHandler writes explicit requestId when header missing', async () => {
  const xray = createEmitter(
    { serviceName: 'test', endpointUrl: 'https://collector' },
    createNoopExporter(),
  );

  let seenLog: any = null;
  await withServer(
    wrapHttpHandler(
      (_req, res) => {
        res.statusCode = 200;
        res.end('ok');
      },
      xray,
      {
        requestId: 'explicit-id',
        onResponse: (_ctx, log) => {
          seenLog = log;
        },
      },
    ),
    async (baseUrl) => {
      const response = await fetch(baseUrl);
      assert.equal(response.headers.get('request-id'), 'explicit-id');
      await response.text();
    },
  );

  assert.ok(seenLog);
  assert.equal(seenLog.requestId, 'explicit-id');
});
