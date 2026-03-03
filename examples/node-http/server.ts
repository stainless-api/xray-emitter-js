import { createServer } from 'node:http';
import { createEmitter, wrapHttpHandler, getXrayContext } from '@stainlessdev/xray-emitter/node';

const hostname = '127.0.0.1';
const port = 3000;

const xray = createEmitter({
  serviceName: 'xray-example',
  endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  // Read from response headers when finalized (default: Request-Id).
  requestId: { header: 'request-id' },
});

const server = createServer(
  wrapHttpHandler(
    (req, res) => {
      const ctx = getXrayContext(req);
      ctx?.setActor('tenant-123', 'user-123');

      const subject = (req.url ?? '').split('/')[2] ?? 'world';
      ctx?.setAttribute('subject', subject);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: `Hello ${subject}` }));
    },
    xray,
    { route: '/hello/:subject' },
  ),
);

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
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
