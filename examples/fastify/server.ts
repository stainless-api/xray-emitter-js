import Fastify from 'fastify';
import { createEmitter, type XrayContext } from '@stainlessdev/xray-emitter/fastify';

const fastify = Fastify({ logger: true });

const xray = createEmitter({
  serviceName: 'xray-example',
  endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  // Read from response headers when finalized (default: Request-Id).
  requestId: { header: 'request-id' },
});

xray(fastify);

function getXray(request: unknown): XrayContext | undefined {
  return (request as { xray?: XrayContext }).xray;
}

fastify.addHook('onRequest', async (request) => {
  getXray(request)?.setActor('tenant-123', 'user-123');
});

fastify.post('/hello/:subject', async (request) => {
  const subject = (request.params as { subject: string }).subject;
  return { message: `Hello ${subject}` };
});

const start = async () => {
  try {
    await fastify.listen({ port: Number(process.env.PORT) || 3000 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  try {
    await fastify.close();
  } finally {
    await xray.shutdown();
  }
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

void start();
