import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import express from 'express';
import { createEmitter } from './express';

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

test('express integration captures route and body', async () => {
  let captured: any = null;
  let expectedUrl = '';
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

  const app = express();
  app.use(xray);

  app.post('/widgets/:id', express.text({ type: '*/*' }), (req, res) => {
    res.type('text/plain').send(`widget:${req.params.id}:${req.body ?? ''}`);
  });

  await withServer(app, async (baseUrl) => {
    expectedUrl = new URL('/widgets/42?source=test', baseUrl).toString();
    const response = await fetch(expectedUrl, {
      method: 'POST',
      body: 'hello',
    });
    const text = await response.text();
    assert.equal(text, 'widget:42:hello');
  });

  assert.ok(captured);
  assert.equal(captured.route, '/widgets/{id}');
  assert.equal(captured.url, expectedUrl);
  assert.equal(captured.requestBody?.value, 'hello');
  assert.equal(captured.responseBody?.value, 'widget:42:hello');
});

test('express integration captures duration', async () => {
  let captured: any = null;
  const delayMs = 25;
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
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

  const app = express();
  app.use(xray);

  app.get('/slow', (_req, res) => {
    setTimeout(() => {
      res.type('text/plain').send('ok');
    }, delayMs);
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/slow`);
    const text = await response.text();
    assert.equal(text, 'ok');
  });

  assert.ok(captured);
  assert.ok(captured.durationMs >= delayMs);
});

test('express integration preserves full request path when middleware is regex-mounted', async () => {
  let captured: any = null;
  let expectedUrl = '';
  const xray = createEmitter(
    {
      serviceName: 'test',
      endpointUrl: 'https://collector',
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

  const app = express();
  app.use(/^\/(?!xray).*/, xray);

  app.post('/api/v3/widgets/:id', express.text({ type: '*/*' }), (req, res) => {
    res.type('text/plain').send(`widget:${req.params.id}:${req.body ?? ''}`);
  });

  await withServer(app, async (baseUrl) => {
    expectedUrl = new URL('/api/v3/widgets/42?source=test', baseUrl).toString();
    const response = await fetch(expectedUrl, {
      method: 'POST',
      body: 'hello',
    });
    const text = await response.text();
    assert.equal(text, 'widget:42:hello');
  });

  assert.ok(captured);
  assert.equal(captured.route, '/api/v3/widgets/{id}');
  assert.equal(captured.url, expectedUrl);
});
