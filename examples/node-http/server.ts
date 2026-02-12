import { createServer } from 'node:http';
import { createEmitter, wrapHttpHandler } from '@stainlessdev/xray-emitter/node';

const hostname = '127.0.0.1';
const port = 3000;

const xray = createEmitter({
  serviceName: 'xray-example',
  endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  // Read from response headers when finalized (default: Request-Id).
  requestId: { header: 'request-id' },
});

const server = createServer(
  wrapHttpHandler((_req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello World!');
  }, xray),
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
