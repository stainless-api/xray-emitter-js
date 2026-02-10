import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import fastify from 'fastify';
import { createEmitter } from '../src/index';

async function withFastify(
  app: ReturnType<typeof fastify>,
  fn: (baseUrl: string) => Promise<void>,
) {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('unexpected server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await app.close();
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

test('fastify integration captures route and body', async () => {
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

  const app = fastify();
  xray(app);

  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/things/:id', async (req, reply) => {
    const params = req.params as { id?: string };
    const id = params.id ?? '';
    const body = typeof req.body === 'string' ? req.body : '';
    reply.type('text/plain').send(`thing:${id}:${body}`);
  });

  await withFastify(app, async (baseUrl) => {
    expectedUrl = new URL('/things/abc?source=test', baseUrl).toString();
    const response = await fetch(expectedUrl, {
      method: 'POST',
      body: 'hello',
    });
    const text = await response.text();
    assert.equal(text, 'thing:abc:hello');
  });

  assert.ok(captured);
  assert.equal(captured.route, '/things/{id}');
  assert.equal(captured.url, expectedUrl);
  assert.equal(captured.requestBody?.value, 'hello');
  assert.equal(captured.responseBody?.value, 'thing:abc:hello');
});

test('fastify integration preserves full request path for prefixed routes', async () => {
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

  const app = fastify();
  xray(app);

  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.register(
    async (instance) => {
      instance.post('/things/:id', async (req, reply) => {
        const params = req.params as { id?: string };
        const id = params.id ?? '';
        const body = typeof req.body === 'string' ? req.body : '';
        reply.type('text/plain').send(`thing:${id}:${body}`);
      });
    },
    { prefix: '/api/v3' },
  );

  await withFastify(app, async (baseUrl) => {
    expectedUrl = new URL('/api/v3/things/abc?source=test', baseUrl).toString();
    const response = await fetch(expectedUrl, {
      method: 'POST',
      body: 'hello',
    });
    const text = await response.text();
    assert.equal(text, 'thing:abc:hello');
  });

  assert.ok(captured);
  assert.equal(captured.url, expectedUrl);
});
