import express from 'express';
import { createEmitter } from '@stainlessdev/xray-emitter/express';
import { getXrayContext } from '@stainlessdev/xray-emitter/node';

const app = express();

const xray = createEmitter({
  serviceName: 'xray-example',
  // Read from response headers when finalized (default: Request-Id).
  requestId: { header: 'request-id' },
});

app.use(xray);

app.use((req, _res, next) => {
  const ctx = getXrayContext(req);
  ctx?.setActor('tenant-123', 'user-123');
  next();
});

app.post('/hello/:subject', (req, res) => {
  const subject = req.params.subject;
  const ctx = getXrayContext(req);
  ctx?.setAttribute('subject', subject);
  res.json({ message: `Hello ${subject}` });
});

const port = Number(process.env.PORT) || 3000;
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
