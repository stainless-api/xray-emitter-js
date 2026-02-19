import Fastify from 'fastify';
import { createEmitter } from '@stainlessdev/xray-emitter/fastify';

const fastify = Fastify({ logger: true });

const xray = createEmitter({
  serviceName: 'xray-example',
  endpointUrl: process.env.STAINLESS_XRAY_ENDPOINT_URL,
  // Read from response headers when finalized (default: Request-Id).
  requestId: { header: 'request-id' },
});

xray(fastify);

fastify.addHook('onRequest', async (request) => {
  const anyRequest = request as typeof request & {
    xray?: { setActor: (tenantId: string, userId: string) => void };
  };
  anyRequest.xray?.setActor('tenant-123', 'user-123');
});

fastify.get('/', async () => {
  return { hello: 'world' };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
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
