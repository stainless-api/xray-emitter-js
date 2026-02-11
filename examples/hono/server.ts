/// <reference types="node" />

import { Hono } from 'hono';
import { routePath } from 'hono/route';
import { serve } from '@hono/node-server';
import { createEmitter, type HonoXrayEnv } from 'xray-js/hono';

const app = new Hono<HonoXrayEnv>();

const xray = createEmitter(
  {
    serviceName: 'xray-example',
    endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
    // Read from response headers when finalized (default: Request-Id).
    requestId: { header: 'request-id' },
  },
  { routePath },
);

app.use('*', xray);
app.use('*', async (c, next) => {
  c.get('xray')?.setUserId('user-123');
  await next();
});

app.get('/', (c) => {
  return c.text('Hello Node.js!');
});

const port = 3000;
serve({ fetch: app.fetch, port });

const shutdown = async () => {
  await xray.shutdown();
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
