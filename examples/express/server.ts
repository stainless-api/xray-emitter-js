import express from 'express';
import { createEmitter } from '@stainlessdev/xray-emitter/express';
import { getXrayContext } from '@stainlessdev/xray-emitter/node';

const app = express();

const xray = createEmitter({
  serviceName: 'xray-example',
  endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  // Read from response headers when finalized (default: Request-Id).
  requestId: { header: 'request-id' },
});

app.use(xray);

app.use((req, _res, next) => {
  const ctx = getXrayContext(req);
  ctx?.setUserId('user-123');
  next();
});

app.get('/', (_req, res) => {
  res.send('Hello World!');
});

app.post('/widgets/:id', express.text({ type: '*/*' }), (req, res) => {
  res.type('text/plain').send(`widget:${req.params.id}:${req.body ?? ''}`);
});

const port = 3000;
const server = app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

const shutdown = async () => {
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    await xray.shutdown();
  }
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
